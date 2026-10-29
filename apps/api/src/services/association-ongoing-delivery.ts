/**
 * Ongoing GHL delivery for a confirmed parent-URL association.
 *
 * Intake calls this after the Sheets intent transaction. A failure here does
 * not roll back the lead or the Sheets intent. Sheets and GHL do not share a
 * retry. An unactivated destination is left alone.
 */

import type { LeadDeliveryPlan, LeadDeliveryPlanStep } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import { findGhlLocationConnectionByLocationId } from "../repositories/ghl-location-connection.repository.js";
import {
  findDeliveryPlanById,
  findDeliveryPlanByRoutingDecisionId,
} from "../repositories/lead-delivery-plan.repository.js";
import { findLatestGhlLiveDeliveryRunForPlan } from "../repositories/ghl-live-delivery-run.repository.js";
import { getDuplicateRiskForRoutingDecision } from "./lead-identity/lead-identity-correlation.service.js";
import { generateDirectCanaryDeliveryPlanForDecision } from "./lead-delivery-plan.service.js";
import { isOngoingGhlServiceEnabled } from "../lib/ghl-ongoing-delivery-scope.js";
import { warmEffectiveDeliveryAdapterMode } from "./delivery-runtime-mode.service.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "./destination-readiness.service.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "./routing-source-association.service.js";
import {
  DELIVER_ONE_GHL_TEST,
  isPersistedLiveDestination,
  ongoingRunDisposition,
  type DeliveryRunDispositionInput,
} from "./ghl-destination-authorization.js";
import { executeRecordedGhlDelivery } from "./ghl-delivery-adapter/ghl-live-canary.service.js";

export type AssociationDeliveryResult = {
  outcome: "skipped" | "executed" | "held";
  reason: string;
  runId: string | null;
  status: string | null;
  externalCallExecuted: boolean;
  contactIdGhl: string | null;
  opportunityIdGhl: string | null;
  workflowStarted: boolean | null;
  omittedCoreFields: string[];
  omittedOptionalFields: string[];
};

type DestinationFacts = {
  clientDisplayName: string;
  locationId: string;
  workflowId: string | null;
  workflowTriggerMode: string | null;
  deliveryEnabled: boolean;
  deliveryMode: string;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  linkedToClient: boolean;
  connectionStatus: string | null;
  otherActivated: boolean;
  omittedCoreFields: string[];
  omittedOptionalFields: string[];
};

type PlanFacts = {
  id: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  routingDryRunDecisionId: string | null;
};

type RunFacts = DeliveryRunDispositionInput & { id: string };

export type AssociationDeliveryDeps = {
  loadDestination: (clientAccountId: string) => Promise<DestinationFacts | null>;
  runtimeCanExecute: () => Promise<boolean>;
  duplicateBlocks: (decisionId: string) => Promise<boolean>;
  findPlan: (decisionId: string) => Promise<PlanFacts | null>;
  createPlan: (decisionId: string) => Promise<{ ok: true; plan: PlanFacts } | { ok: false; reason: string }>;
  findRun: (planId: string) => Promise<RunFacts | null>;
  execute: (input: {
    planId: string;
    mode: "ongoing_association" | "paused_location_test";
    reuseRunId: string | null;
    confirmation: string | null;
    lifecyclePayload?: LifecycleEventSchema;
  }) => Promise<{
    held: boolean;
    status: string;
    runId: string | null;
    externalCallExecuted: boolean;
    errors: string[];
    contactIdGhl?: string | null;
    opportunityIdGhl?: string | null;
    workflowStarted?: boolean | null;
  }>;
};

const quiet = (reason: string, omitted?: Pick<DestinationFacts, "omittedCoreFields" | "omittedOptionalFields">): AssociationDeliveryResult => ({
  outcome: "skipped",
  reason,
  runId: null,
  status: null,
  externalCallExecuted: false,
  contactIdGhl: null,
  opportunityIdGhl: null,
  workflowStarted: null,
  omittedCoreFields: omitted?.omittedCoreFields ?? [],
  omittedOptionalFields: omitted?.omittedOptionalFields ?? [],
});

function workflowReady(facts: DestinationFacts): boolean {
  return Boolean(facts.workflowId?.trim()) && facts.workflowTriggerMode !== "none";
}

function destinationReadyForWrite(facts: DestinationFacts, locationId: string): string | null {
  if (facts.otherActivated) return "location_owned_by_other_client";
  if (!facts.linkedToClient || facts.connectionStatus !== "connected") return "oauth_not_connected";
  if (facts.locationId.trim() !== locationId.trim()) return "location_mismatch";
  if (!workflowReady(facts)) return "workflow_required";
  return null;
}

async function deliverLoadedPlan(
  input: {
    mode: "ongoing_association" | "paused_location_test";
    confirmation: string | null;
    decisionId: string;
    lifecyclePayload?: LifecycleEventSchema;
    facts: DestinationFacts;
  },
  deps: AssociationDeliveryDeps
): Promise<AssociationDeliveryResult> {
  let plan = await deps.findPlan(input.decisionId);
  if (!plan && input.mode === "ongoing_association") {
    const created = await deps.createPlan(input.decisionId);
    if (!created.ok) return quiet(created.reason, input.facts);
    plan = created.plan;
  }
  if (!plan) return quiet("plan_required", input.facts);
  if (plan.destinationSubaccountIdGhl.trim() !== input.facts.locationId.trim()) {
    return quiet("location_mismatch", input.facts);
  }
  if (await deps.duplicateBlocks(input.decisionId)) return quiet("duplicate_blocked", input.facts);
  const existing = await deps.findRun(plan.id);
  const disposition = ongoingRunDisposition(existing);
  if (disposition === "hold") {
    return {
      outcome: "held",
      reason: existing?.status ?? "held",
      runId: existing?.id ?? null,
      status: existing?.status ?? null,
      externalCallExecuted: false,
      contactIdGhl: null,
      opportunityIdGhl: null,
      workflowStarted: null,
      omittedCoreFields: input.facts.omittedCoreFields,
      omittedOptionalFields: input.facts.omittedOptionalFields,
    };
  }
  const execution = await deps.execute({
    planId: plan.id,
    mode: input.mode,
    reuseRunId: disposition === "retry" ? existing?.id ?? null : null,
    confirmation: input.confirmation,
    lifecyclePayload: input.lifecyclePayload,
  });
  return {
    outcome: execution.held ? "held" : "executed",
    reason: execution.status,
    runId: execution.runId,
    status: execution.status,
    externalCallExecuted: execution.externalCallExecuted,
    contactIdGhl: execution.contactIdGhl ?? null,
    opportunityIdGhl: execution.opportunityIdGhl ?? null,
    workflowStarted: execution.workflowStarted ?? null,
    omittedCoreFields: input.facts.omittedCoreFields,
    omittedOptionalFields: input.facts.omittedOptionalFields,
  };
}

export async function deliverConfirmedAssociationIfActivated(
  input: {
    sourceLeadEventId: string;
    status: string;
    routing: {
      matched: boolean;
      routingDryRunDecisionId?: string | null;
      routingAuthority?: string | null;
      destinationClientAccountId?: string | null;
      destinationLocationIdGhl?: string | null;
    };
    lifecyclePayload?: LifecycleEventSchema;
  },
  deps: AssociationDeliveryDeps = realAssociationDeliveryDeps()
): Promise<AssociationDeliveryResult> {
  try {
    if (input.status !== "routing_matched" || input.routing.matched !== true) return quiet("not_matched");
    if (input.routing.routingAuthority !== ROUTING_AUTHORITY_SOURCE_ASSOCIATION) return quiet("not_association");
    const decisionId = input.routing.routingDryRunDecisionId?.trim() ?? "";
    const clientAccountId = input.routing.destinationClientAccountId?.trim() ?? "";
    const locationId = input.routing.destinationLocationIdGhl?.trim() ?? "";
    if (!decisionId || !clientAccountId || !locationId) return quiet("destination_not_activated");
    const facts = await deps.loadDestination(clientAccountId);
    if (
      !facts ||
      !isPersistedLiveDestination(
        {
          deliveryEnabled: facts.deliveryEnabled,
          deliveryMode: facts.deliveryMode,
          clientCutoverApproved: facts.clientCutoverApproved,
          internalApprovalStatus: facts.internalApprovalStatus,
          destinationSubaccountIdGhl: facts.locationId,
        },
        locationId
      )
    ) {
      return quiet("destination_not_activated");
    }
    const blocked = destinationReadyForWrite(facts, locationId);
    if (blocked) return quiet(blocked, facts);
    if (!(await deps.runtimeCanExecute())) {
      logger.warn("association_ghl.adapter_mode_inactive", { sourceLeadEventId: input.sourceLeadEventId, clientAccountId });
      return quiet("adapter_mode_inactive", facts);
    }
    const result = await deliverLoadedPlan(
      {
        mode: "ongoing_association",
        confirmation: null,
        decisionId,
        lifecyclePayload: input.lifecyclePayload,
        facts,
      },
      deps
    );
    if (result.outcome === "executed" || result.outcome === "held") {
      logger.info("association_ghl.recorded", {
        sourceLeadEventId: input.sourceLeadEventId,
        clientAccountId,
        outcome: result.outcome,
        status: result.status,
        runId: result.runId,
      });
    }
    return result;
  } catch (err) {
    logger.warn("association_ghl.ongoing_failed", {
      sourceLeadEventId: input.sourceLeadEventId,
      errorName: err instanceof Error ? err.name : "Error",
    });
    return quiet("delivery_failed");
  }
}

export async function executeSelectedGhlDeliveryTest(
  input: {
    clientAccountId: string;
    planId: string;
    confirmation: string;
  },
  deps: AssociationDeliveryDeps = realAssociationDeliveryDeps()
): Promise<AssociationDeliveryResult & { statusCode: number }> {
  if (input.confirmation.trim() !== DELIVER_ONE_GHL_TEST) {
    return { ...quiet("invalid_confirmation"), statusCode: 400 };
  }
  const plan = await deps.findPlan(input.planId);
  if (!plan) return { ...quiet("plan_required"), statusCode: 404 };
  if (plan.destinationClientAccountId !== input.clientAccountId.trim()) {
    return { ...quiet("tenant_mismatch"), statusCode: 403 };
  }
  const decisionId = plan.routingDryRunDecisionId?.trim() ?? "";
  if (!decisionId) return { ...quiet("plan_required"), statusCode: 409 };
  const facts = await deps.loadDestination(input.clientAccountId.trim());
  if (!facts) return { ...quiet("destination_not_configured"), statusCode: 409 };
  const blocked = destinationReadyForWrite(facts, plan.destinationSubaccountIdGhl);
  if (blocked) return { ...quiet(blocked, facts), statusCode: 409 };
  if (!(await deps.runtimeCanExecute())) {
    return { ...quiet("adapter_mode_inactive", facts), statusCode: 409 };
  }
  const result = await deliverLoadedPlan(
    {
      mode: "paused_location_test",
      confirmation: DELIVER_ONE_GHL_TEST,
      decisionId,
      facts,
    },
    deps
  );
  const statusCode = result.outcome === "skipped" && result.reason === "duplicate_blocked" ? 409 : 200;
  return { ...result, statusCode: result.outcome === "skipped" ? statusCode : 200 };
}

function planFactsFrom(plan: {
  id: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  routingDryRunDecisionId: string | null;
}): PlanFacts {
  return {
    id: plan.id,
    destinationClientAccountId: plan.destinationClientAccountId,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    routingDryRunDecisionId: plan.routingDryRunDecisionId,
  };
}

function realAssociationDeliveryDeps(): AssociationDeliveryDeps {
  return {
    loadDestination: loadDestinationFacts,
    runtimeCanExecute: async () =>
      isOngoingGhlServiceEnabled() || (await warmEffectiveDeliveryAdapterMode()).canRunLiveCanary,
    duplicateBlocks: async (decisionId) => {
      const risk = await getDuplicateRiskForRoutingDecision(decisionId);
      return risk?.blocksLiveDelivery === true;
    },
    findPlan: async (id) => {
      const byDecision = await findDeliveryPlanByRoutingDecisionId(id);
      if (byDecision) return planFactsFrom(byDecision);
      const byId = await findDeliveryPlanById(id);
      return byId ? planFactsFrom(byId) : null;
    },
    createPlan: async (decisionId) => {
      const created = await generateDirectCanaryDeliveryPlanForDecision(decisionId);
      if ("plan" in created) return { ok: true, plan: planFactsFrom(created.plan) };
      if ("blocked" in created) return { ok: false, reason: created.blocked };
      return { ok: false, reason: "plan_required" };
    },
    findRun: async (planId) => {
      const run = await findLatestGhlLiveDeliveryRunForPlan(planId);
      if (!run) return null;
      return {
        id: run.id,
        status: run.status,
        stepRuns: run.stepRuns.map((step) => ({
          errorCode: step.errorCode,
          responseRedactedJson: step.responseRedactedJson,
        })),
      };
    },
    execute: async (request) => {
      const plan = await findDeliveryPlanById(request.planId);
      if (!plan) {
        return { held: true, status: "failed", runId: null, externalCallExecuted: false, errors: ["plan_required"] };
      }
      const recorded = await executeRecordedGhlDelivery({
        plan: plan as LeadDeliveryPlan & { steps: LeadDeliveryPlanStep[] },
        mode: request.mode,
        executedBy: request.mode === "ongoing_association" ? "association_intake" : "admin_operator",
        operatorConfirmationText: request.confirmation,
        lifecyclePayload: request.lifecyclePayload,
        reuseRunId: request.reuseRunId,
      });
      return recorded;
    },
  };
}

async function loadDestinationFacts(clientAccountId: string): Promise<DestinationFacts | null> {
  const client = await findClientAccountById(clientAccountId);
  const destination = client?.ghlDestination;
  if (!client || !destination) return null;
  const locationId = destination.destinationSubaccountIdGhl.trim();
  const connection = locationId ? await findGhlLocationConnectionByLocationId(locationId) : null;
  const otherActivated = locationId
    ? (await prisma.clientGhlDestination.count({
        where: {
          destinationSubaccountIdGhl: locationId,
          clientAccountId: { not: clientAccountId },
          deliveryEnabled: true,
        },
      })) > 0
    : false;
  let omittedCoreFields: string[] = [];
  let omittedOptionalFields: string[] = [];
  try {
    const readiness = evaluateDestinationReadiness(
      destinationInputFromGhlDestination(
        { clientAccountId, clientDisplayName: client.clientDisplayName },
        destination,
        connection
          ? {
              connectionStatus: connection.connectionStatus,
              lastProbeAt: connection.lastProbeAt,
              lastError: connection.lastError,
            }
          : null
      )
    );
    omittedCoreFields = readiness.fieldMapping.coreRequiredMissing;
    omittedOptionalFields = readiness.fieldMapping.optionalMissing;
  } catch {
    omittedCoreFields = [];
    omittedOptionalFields = [];
  }
  return {
    clientDisplayName: client.clientDisplayName,
    locationId,
    workflowId: destination.destinationWorkflowIdGhl,
    workflowTriggerMode: destination.workflowTriggerMode,
    deliveryEnabled: destination.deliveryEnabled,
    deliveryMode: destination.deliveryMode,
    clientCutoverApproved: destination.clientCutoverApproved,
    internalApprovalStatus: destination.internalApprovalStatus,
    linkedToClient: connection?.clientAccountId === clientAccountId,
    connectionStatus: connection?.connectionStatus ?? null,
    otherActivated,
    omittedCoreFields,
    omittedOptionalFields,
  };
}
