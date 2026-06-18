import type { SourceLeadEvent } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  isGhlAdapterSimulationAllowed,
  getGhlDeliveryAdapterMaxMode,
} from "../../lib/ghl-delivery-adapter-mode.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById, updateSourceLeadEvent } from "../../repositories/source-lead-event.repository.js";
import { findBulkLeadImportById } from "../../repositories/bulk-lead-import.repository.js";
import { runGhlAdapterSimulationForPlan } from "../ghl-delivery-adapter-run.service.js";
import {
  collectDirectCanaryPlanDiagnostics,
  formatDirectCanaryPlanBlockers,
  generateManualBulkImportDeliveryPlanForDecision,
  type ManualDestinationPlanSource,
} from "../lead-delivery-plan.service.js";
import { runManualBulkImportRoutingDryRun } from "../routing-dry-run.service.js";
import type { RoutingDryRunLeadIdentity } from "../routing-dry-run-admin.present.js";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { validateBulkImportDestinationSelection } from "./bulk-import-destination.js";
import type { BulkImportOptions, ManualBulkImportRoutingDecision } from "./bulk-import.types.js";
import { batchHasLiveDeliveryApproval } from "./bulk-import-wizard-metadata.service.js";

const SIMULATION_APPROVABLE_STATUSES = new Set([
  "routing_matched",
  "needs_review",
  "duplicate_blocked",
]);

export type BulkImportSimulationSuccess = {
  ok: true;
  routingDryRunDecisionId: string;
  deliveryPlanId: string;
  adapterRunId: string | null;
  externalCallExecuted: false;
  summary: string;
  blockers: string[];
  warnings: string[];
  nextAction: string;
  deliveryPlanStatus: string | null;
  adapterSimulationDetail: string | null;
  missingConfigFields: string[];
};

export type BulkImportSimulationFailure = {
  ok: false;
  error: string;
  reason: string;
  routingDryRunDecisionId: string | null;
  deliveryPlanId: string | null;
  adapterRunId: string | null;
  externalCallExecuted: false;
  blockers: string[];
  warnings: string[];
  nextAction: string;
  deliveryPlanStatus: string | null;
  adapterSimulationDetail: string | null;
  missingConfigFields: string[];
};

export type BulkImportSimulationResult = BulkImportSimulationSuccess | BulkImportSimulationFailure;

export type BulkImportSimulationDeps = {
  runManualRoutingDryRun?: typeof runManualBulkImportRoutingDryRun;
  generatePlan?: typeof generateManualBulkImportDeliveryPlanForDecision;
  runAdapterSimulation?: typeof runGhlAdapterSimulationForPlan;
  validateDestination?: typeof validateBulkImportDestinationSelection;
  findEvent?: typeof findSourceLeadEventById;
  findBatch?: typeof findBulkLeadImportById;
  updateEvent?: typeof updateSourceLeadEvent;
};

function leadIdentityFromPayload(payload: LifecycleEventSchema): RoutingDryRunLeadIdentity {
  const c = payload.contact;
  const first = c.first_name?.trim() || null;
  const last = c.last_name?.trim() || null;
  const display =
    [first, last].filter(Boolean).join(" ").trim() || c.email?.trim() || null;
  return {
    contactIdGhl: c.contact_id_ghl?.trim() ?? null,
    firstName: first,
    lastName: last,
    displayName: display || null,
    phoneE164: c.phone_e164?.trim() || c.phone?.trim() || null,
    email: c.email?.trim() || null,
  };
}

function parseNormalizedPayload(event: SourceLeadEvent): LifecycleEventSchema | null {
  const raw = event.normalizedPayloadJson;
  if (!raw || typeof raw !== "object") return null;
  const parsed = lifecycleEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function manualRoutingFromEvent(event: SourceLeadEvent): ManualBulkImportRoutingDecision | null {
  const routing = event.routingResultJson as {
    matchType?: string;
    manualDecision?: ManualBulkImportRoutingDecision;
  } | null;
  if (routing?.matchType === "manual_bulk_import" && routing.manualDecision) {
    return routing.manualDecision;
  }
  return null;
}

export function shouldRepairSimulationOnlySourceLeadEvent(event: {
  status: string;
  bulkImportId: string | null;
  approvedAt: Date | null;
  deliveredAt: Date | null;
  deliveryResultJson: unknown;
  clientAccountIdResolved: string | null;
}): boolean {
  if (!event.bulkImportId) return false;
  if (event.deliveredAt) return false;
  if (event.status !== "delivery_failed" && event.status !== "approved") return false;

  const delivery = event.deliveryResultJson as {
    mode?: string;
    externalCallExecuted?: boolean;
    contactIdGhl?: string | null;
    opportunityIdGhl?: string | null;
  } | null;

  if (delivery?.externalCallExecuted === true) return false;
  if (delivery?.contactIdGhl || delivery?.opportunityIdGhl) return false;
  if (delivery?.mode === "live_canary") return false;

  if (event.status === "approved" && !event.deliveredAt) {
    return delivery?.mode === "simulate" || delivery == null;
  }

  if (event.status === "delivery_failed") {
    return delivery?.mode === "simulate" || delivery?.externalCallExecuted === false || !delivery;
  }

  return false;
}

export function restoredStatusForRepairedSimulationEvent(event: {
  routingResultJson: unknown;
  clientAccountIdResolved: string | null;
}): "routing_matched" | "needs_review" {
  const routing = event.routingResultJson as { matched?: boolean } | null;
  if (routing?.matched && event.clientAccountIdResolved) return "routing_matched";
  return "needs_review";
}

export async function repairSimulationOnlySourceLeadEvent(
  event: SourceLeadEvent,
  deps: Pick<BulkImportSimulationDeps, "updateEvent"> = {}
): Promise<SourceLeadEvent> {
  const updateEvent = deps.updateEvent ?? updateSourceLeadEvent;
  if (!shouldRepairSimulationOnlySourceLeadEvent(event)) return event;

  const nextStatus = restoredStatusForRepairedSimulationEvent(event);
  return updateEvent(event.id, {
    status: nextStatus,
    approvedAt: null,
    approvedBy: null,
    errorSummary: null,
  });
}

function failure(
  partial: Partial<Omit<BulkImportSimulationFailure, "ok" | "externalCallExecuted">> &
    Pick<BulkImportSimulationFailure, "error" | "reason">
): BulkImportSimulationFailure {
  return {
    ok: false,
    externalCallExecuted: false,
    routingDryRunDecisionId: null,
    deliveryPlanId: null,
    adapterRunId: null,
    blockers: [],
    warnings: [],
    nextAction: "Review simulation blockers and retry.",
    deliveryPlanStatus: null,
    adapterSimulationDetail: null,
    missingConfigFields: [],
    ...partial,
  };
}

function manualDestinationFromClient(
  client: NonNullable<Awaited<ReturnType<typeof findClientAccountById>>>,
  manual: ManualBulkImportRoutingDecision
): ManualDestinationPlanSource {
  const dest = client.ghlDestination!;
  return {
    clientAccountId: client.clientAccountId,
    clientDisplayName: client.clientDisplayName,
    nicheKey: manual.nicheKey ?? null,
    productType: manual.productType ?? null,
    destinationSubaccountIdGhl: manual.destinationLocationIdGhl,
    destinationPipelineIdGhl: dest.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: dest.destinationPipelineStageIdGhl,
    destinationWorkflowIdGhl: dest.destinationWorkflowIdGhl,
    defaultAssignedUserIdGhl: dest.defaultAssignedUserIdGhl,
    opportunityCreationEnabled: dest.opportunityCreationEnabled ?? false,
  };
}

/** Simulate adapter delivery for a bulk import row using the operator-selected destination. */
export async function simulateBulkImportResolvedDestination(
  sourceLeadEventId: string,
  deps: BulkImportSimulationDeps = {}
): Promise<BulkImportSimulationResult> {
  const findEvent = deps.findEvent ?? findSourceLeadEventById;
  const findBatch = deps.findBatch ?? findBulkLeadImportById;
  const updateEvent = deps.updateEvent ?? updateSourceLeadEvent;
  const runManualRoutingDryRun = deps.runManualRoutingDryRun ?? runManualBulkImportRoutingDryRun;
  const generatePlan = deps.generatePlan ?? generateManualBulkImportDeliveryPlanForDecision;
  const runAdapterSimulation = deps.runAdapterSimulation ?? runGhlAdapterSimulationForPlan;
  const validateDestination = deps.validateDestination ?? validateBulkImportDestinationSelection;

  let event = await findEvent(sourceLeadEventId);
  if (!event) {
    return failure({
      error: "not_found",
      reason: "Source lead event not found.",
    });
  }

  event = await repairSimulationOnlySourceLeadEvent(event, { updateEvent });

  if (event.status === "delivered") {
    return failure({
      error: "already_delivered",
      reason: "This source lead was already delivered.",
    });
  }

  if (!SIMULATION_APPROVABLE_STATUSES.has(event.status)) {
    return failure({
      error: "invalid_status",
      reason: `Source lead status ${event.status} is not eligible for simulation.`,
    });
  }

  if (!event.bulkImportId) {
    return failure({
      error: "not_bulk_import",
      reason: "Source lead is not linked to a bulk import batch.",
    });
  }

  const batch = await findBatch(event.bulkImportId);
  if (!batch) {
    return failure({
      error: "batch_not_found",
      reason: "Bulk import batch not found.",
    });
  }

  if (batchHasLiveDeliveryApproval(batch)) {
    return failure({
      error: "live_delivery_started",
      reason: "Bulk import batch has live delivery approval; simulation is no longer available.",
    });
  }

  const batchClient = batch.destinationClientAccountId?.trim() ?? "";
  const batchLocation = batch.destinationLocationIdGhl?.trim() ?? "";
  const eventClient = event.clientAccountIdResolved?.trim() ?? "";
  const eventLocation = event.destinationLocationIdResolved?.trim() ?? "";

  if (!batchClient || !batchLocation) {
    return failure({
      error: "destination_missing",
      reason: "Bulk import batch destination is not configured.",
    });
  }

  if (eventClient !== batchClient || eventLocation !== batchLocation) {
    return failure({
      error: "destination_mismatch",
      reason:
        "Source lead destination does not match the bulk import batch destination.",
      blockers: [
        `Batch destination: ${batchClient}/${batchLocation}`,
        `Event destination: ${eventClient || "—"}/${eventLocation || "—"}`,
      ],
      nextAction: "Rerun normalization or reset destination to align destinations.",
    });
  }

  const manualRouting = manualRoutingFromEvent(event);
  if (!manualRouting) {
    return failure({
      error: "manual_routing_missing",
      reason: "Bulk import manual routing metadata is missing on the source lead event.",
      nextAction: "Rerun normalization after destination selection.",
    });
  }

  try {
    await validateDestination({
      destinationClientAccountId: batchClient,
      destinationLocationIdGhl: batchLocation,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "destination_not_ready";
    return failure({
      error: code,
      reason: `Destination is not ready for simulation (${code}).`,
      nextAction: "Reconnect OAuth and complete destination configuration.",
    });
  }

  if (!isGhlAdapterSimulationAllowed()) {
    const max = getGhlDeliveryAdapterMaxMode();
    const reason = `Adapter simulation is disabled (current max mode: ${max}).`;
    return failure({
      error: "delivery_blocked",
      reason,
      blockers: [reason],
      nextAction: "Set GHL_DELIVERY_ADAPTER_MAX_MODE to allow simulation.",
    });
  }

  const payload = parseNormalizedPayload(event);
  if (!payload) {
    return failure({
      error: "invalid_payload",
      reason: "Normalized lifecycle payload missing or invalid.",
    });
  }

  const client = await findClientAccountById(batchClient);
  if (!client?.ghlDestination) {
    return failure({
      error: "destination_not_found",
      reason: "Client GHL destination configuration not found.",
    });
  }

  const manualDestination = manualDestinationFromClient(client, manualRouting);
  const importOptions = (batch.importOptionsJson ?? {}) as BulkImportOptions;
  if (importOptions.workflowStrategy === "source_tag_only") {
    manualDestination.destinationWorkflowIdGhl = null;
    manualDestination.opportunityCreationEnabled = false;
  }

  let dryRun;
  try {
    dryRun = await runManualRoutingDryRun({
      payload,
      destinationClientAccountId: batchClient,
      destinationLocationIdGhl: batchLocation,
      masterClientAccountId: payload.client_account_id,
      matchReason: manualRouting.routingAuthority,
    });
  } catch (err) {
    return failure({
      error: "routing_failed",
      reason: err instanceof Error ? err.message : "Manual routing dry-run failed.",
      blockers: ["Manual routing dry-run failed."],
    });
  }

  const attribution = extractRoutingAttributionFromPayload(payload);
  const leadIdentity = leadIdentityFromPayload(payload);

  const planResult = await generatePlan(dryRun.decisionId, manualDestination, {
    leadIdentity,
    attribution,
  });
  if ("notFound" in planResult) {
    return failure({
      error: "plan_not_found",
      reason: "Routing decision not found after manual routing dry-run.",
      routingDryRunDecisionId: dryRun.decisionId,
    });
  }

  const plan = planResult.plan;
  const planDiagnostics = collectDirectCanaryPlanDiagnostics(plan);
  const blockedStatuses = new Set(["blocked", "needs_config"]);
  if (blockedStatuses.has(plan.status)) {
    const planBlockers = formatDirectCanaryPlanBlockers(planDiagnostics, null);
    return failure({
      error: "delivery_blocked",
      reason: `Adapter plan status is ${plan.status}.`,
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: plan.id,
      blockers: planBlockers,
      deliveryPlanStatus: plan.status,
      missingConfigFields: planDiagnostics.missingConfigFields,
      nextAction:
        planDiagnostics.missingConfigFields.length > 0
          ? `Resolve missing adapter config: ${planDiagnostics.missingConfigFields.join(", ")}.`
          : "Review adapter plan step issues and destination readiness.",
    });
  }

  const sim = await runAdapterSimulation(plan.id, { checkLiveReadiness: true });
  if ("notFound" in sim) {
    return failure({
      error: "plan_missing",
      reason: "Delivery plan not found for adapter simulation.",
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: plan.id,
      blockers: ["Adapter simulation could not load plan."],
    });
  }

  const deliveryJson = {
    mode: "simulate" as const,
    routingAuthority: "manual_bulk_import" as const,
    matched: true,
    destinationClientAccountId: batchClient,
    destinationSubaccountIdGhl: batchLocation,
    routingDryRunDecisionId: dryRun.decisionId,
    deliveryPlanId: plan.id,
    adapterRunId: sim.adapterRun?.id ?? null,
    externalCallExecuted: false,
    summary: sim.adapterRun?.summary ?? null,
    blockers: sim.ok ? [] : [sim.blockedReason ?? "Adapter simulation blocked."],
    adapterSimulationPassed: sim.ok,
    adapterSimulationDetail: sim.adapterRun?.summary ?? sim.blockedReason ?? null,
    deliveryPlanStatus: plan.status,
    missingConfigFields: planDiagnostics.missingConfigFields,
  };

  await updateEvent(event.id, {
    routingDryRunDecisionId: dryRun.decisionId,
    deliveryResultJson: deliveryJson,
  });

  if (!sim.ok) {
    return failure({
      error: "simulation_failed",
      reason: sim.blockedReason || "GHL adapter simulation did not pass.",
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: plan.id,
      adapterRunId: sim.adapterRun?.id ?? null,
      blockers: [sim.blockedReason || "Adapter simulation blocked."],
      deliveryPlanStatus: plan.status,
      adapterSimulationDetail: sim.adapterRun?.summary ?? sim.blockedReason ?? null,
      missingConfigFields: planDiagnostics.missingConfigFields,
      nextAction: "Fix adapter validation blockers and retry simulation.",
    });
  }

  return {
    ok: true,
    routingDryRunDecisionId: dryRun.decisionId,
    deliveryPlanId: plan.id,
    adapterRunId: sim.adapterRun?.id ?? null,
    externalCallExecuted: false,
    summary: sim.adapterRun?.summary ?? "GHL adapter simulation completed (no external writes).",
    blockers: [],
    warnings: [],
    nextAction: "Review simulation output, then approve for live delivery when ready.",
    deliveryPlanStatus: plan.status,
    adapterSimulationDetail: sim.adapterRun?.summary ?? null,
    missingConfigFields: planDiagnostics.missingConfigFields,
  };
}
