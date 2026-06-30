import type { CampaignRoutingRule } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  extractRoutingAttributionFromPayload,
} from "../../lib/routing-attribution-extract.js";
import {
  getGhlDeliveryAdapterMaxMode,
  getGhlDeliveryAdapterMode,
  isGhlAdapterSimulationAllowed,
  LIVE_CANARY_CONFIRMATION_TEXT,
} from "../../lib/ghl-delivery-adapter-mode.js";
import {
  warmEffectiveDeliveryAdapterMode,
  type ResolvedDeliveryRuntimeMode,
} from "../delivery-runtime-mode.service.js";
import {
  isDestinationAllowedForLiveCanary,
} from "../../lib/direct-demo-delivery-config.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findRoutingDryRunDecisionById } from "../../repositories/routing-dry-run-decision.repository.js";
import {
  findDeliveryPlanById,
  findDeliveryPlanByRoutingDecisionId,
} from "../../repositories/lead-delivery-plan.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import type { DirectDemoDeliveryBody } from "../../schemas/lead-delivery-direct-demo.schema.js";
import { runGhlAdapterSimulationForPlan } from "../ghl-delivery-adapter-run.service.js";
import {
  executeLiveCanaryForPlan,
  getLiveCanaryPreflightForPlan,
} from "../ghl-delivery-adapter/ghl-live-canary.service.js";
import {
  summarizeLiveCanaryFailureFromRun,
  type LiveCanaryFailureSummary,
} from "../ghl-delivery-adapter/ghl-live-canary-failure.present.js";
import {
  summarizeLiveCanaryStepsFromRun,
  type LiveCanaryStepSummary,
} from "../ghl-delivery-adapter/ghl-live-canary-steps.present.js";
import {
  getDuplicateRiskForRoutingDecision,
} from "../lead-identity/lead-identity-correlation.service.js";
import type { DuplicateRiskAssessmentItem } from "../lead-identity/lead-identity.types.js";
import {
  DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY,
  inferDirectDemoSourceLane,
  presentDuplicateRiskForDirectDemo,
  recommendedActionForDirectDemo,
  type DirectDemoSourceLane,
} from "./direct-demo-delivery.present.js";
import {
  DELIVERY_PLAN_TYPES,
  type DeliveryPlanType,
} from "../../lib/lead-delivery-plan-types.js";
import {
  collectDirectCanaryPlanDiagnostics,
  formatDirectCanaryPlanBlockers,
  generateDirectCanaryDeliveryPlanForDecision,
} from "../lead-delivery-plan.service.js";
import { evaluateDeliveryReadiness } from "../delivery-readiness.service.js";
import { DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY } from "../ghl-delivery-adapter/ghl-live-canary-step-requirements.js";
import {
  clientDestinationFieldMappingFromDest,
  ruleToReadinessInput,
} from "../delivery-readiness-admin.present.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";
import type { RoutingDryRunLeadIdentity } from "../routing-dry-run-admin.present.js";
import { runRoutingDryRun } from "../routing-dry-run.service.js";
import {
  isBulkImportLifecyclePayload,
  prepareBulkImportPayloadForRoutingDryRun,
} from "../bulk-import/bulk-import-routing-master.service.js";

const BLOCKED_PLAN_STATUSES = new Set(["blocked", "needs_config"]);

export type DirectDemoMatchedRuleSummary = {
  id: string;
  matchType: string;
  matchValue: string | null;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
};

function directDemoMatchedRuleSummary(
  rule: CampaignRoutingRule | null
): DirectDemoMatchedRuleSummary | null {
  if (!rule) return null;
  const matchValue =
    rule.campaignId?.trim() ||
    rule.utmCampaign?.trim() ||
    rule.adsetId?.trim() ||
    rule.adId?.trim() ||
    rule.formId?.trim() ||
    rule.keywordPattern?.trim() ||
    null;
  return {
    id: rule.id,
    matchType: rule.matchType,
    matchValue,
    clientAccountId: rule.clientAccountId,
    destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
  };
}

export type DirectDemoDeliverySuccess = {
  ok: true;
  mode: "simulate" | "live_canary";
  matched: true;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  routingDryRunDecisionId: string;
  deliveryPlanId: string;
  adapterRunId: string | null;
  liveRunId: string | null;
  externalCallExecuted: boolean;
  summary: string;
  blockers: string[];
  warnings: string[];
  nextAction: string;
  matchedRuleId: string | null;
  matchedRuleSummary?: DirectDemoMatchedRuleSummary | null;
  fieldMappingSource?: string | null;
  duplicateRisk: DuplicateRiskAssessmentItem | null;
  readiness: ReturnType<typeof evaluateDeliveryReadiness> | null;
  deliveryPlanStatus: string;
  planType?: DeliveryPlanType;
  planPath?: "adapter_plan" | "shadow_plan";
  missingConfigFields?: string[];
  adapterMode: string;
  latestAdapterRunId?: string | null;
  latestAdapterRunStatus?: string | null;
  latestAdapterRunMode?: string | null;
  adapterSimulationPassed?: boolean | null;
  adapterSimulationDetail?: string | null;
  liveRunStatus?: string | null;
  liveRunFailure?: LiveCanaryFailureSummary | null;
  liveRunStepSummary?: LiveCanaryStepSummary[];
  contactIdGhl?: string | null;
  opportunityIdGhl?: string | null;
  sourceLane?: DirectDemoSourceLane;
  sourceLaneLabel?: string;
};

export type DirectDemoDeliveryFailure = {
  ok: false;
  error: string;
  reason: string;
  mode: "simulate" | "live_canary";
  matched: boolean;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  routingDryRunDecisionId: string | null;
  deliveryPlanId: string | null;
  adapterRunId: string | null;
  liveRunId: string | null;
  externalCallExecuted: boolean;
  blockers: string[];
  warnings: string[];
  nextAction: string;
  latestAdapterRunId?: string | null;
  latestAdapterRunStatus?: string | null;
  latestAdapterRunMode?: string | null;
  adapterSimulationPassed?: boolean | null;
  adapterSimulationDetail?: string | null;
  liveRunStatus?: string | null;
  liveRunFailure?: LiveCanaryFailureSummary | null;
  liveRunStepSummary?: LiveCanaryStepSummary[];
  contactIdGhl?: string | null;
  opportunityIdGhl?: string | null;
  matchedRuleId?: string | null;
  matchedRuleSummary?: DirectDemoMatchedRuleSummary | null;
  fieldMappingSource?: string | null;
  duplicateRisk?: DuplicateRiskAssessmentItem | null;
  readiness?: ReturnType<typeof evaluateDeliveryReadiness> | null;
  deliveryPlanStatus?: string | null;
  planType?: DeliveryPlanType | null;
  planPath?: "adapter_plan" | "shadow_plan" | null;
  missingConfigFields?: string[];
  adapterMode?: string | null;
  sourceLane?: DirectDemoSourceLane;
  sourceLaneLabel?: string;
};

export type DirectDemoDeliveryResult = DirectDemoDeliverySuccess | DirectDemoDeliveryFailure;

export type DirectDemoDeliveryDeps = {
  runRoutingDryRun?: typeof runRoutingDryRun;
  generateDirectCanaryDeliveryPlanForDecision?: typeof generateDirectCanaryDeliveryPlanForDecision;
  runGhlAdapterSimulationForPlan?: typeof runGhlAdapterSimulationForPlan;
  getLiveCanaryPreflightForPlan?: typeof getLiveCanaryPreflightForPlan;
  executeLiveCanaryForPlan?: typeof executeLiveCanaryForPlan;
  findCampaignRoutingRuleById?: typeof findCampaignRoutingRuleById;
  getDuplicateRiskForRoutingDecision?: typeof getDuplicateRiskForRoutingDecision;
  findRoutingDryRunDecisionById?: typeof findRoutingDryRunDecisionById;
  findDeliveryPlanById?: typeof findDeliveryPlanById;
  findDeliveryPlanByRoutingDecisionId?: typeof findDeliveryPlanByRoutingDecisionId;
  findClientAccountById?: typeof findClientAccountById;
  findGhlLocationConnectionByLocationId?: typeof findGhlLocationConnectionByLocationId;
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

const EMPTY_ADAPTER_GATE = {
  latestAdapterRunId: null,
  latestAdapterRunStatus: null,
  latestAdapterRunMode: null,
  adapterSimulationPassed: null,
  adapterSimulationDetail: null,
} as const;

function adapterGateFromPreflight(preflight: {
  lastAdapterSimulationRunId: string | null;
  lastAdapterSimulationStatus: string | null;
  lastAdapterSimulationMode: string | null;
  lastAdapterSimulationPassed: boolean;
  lastAdapterSimulationDetail: string;
}) {
  return {
    latestAdapterRunId: preflight.lastAdapterSimulationRunId,
    latestAdapterRunStatus: preflight.lastAdapterSimulationStatus,
    latestAdapterRunMode: preflight.lastAdapterSimulationMode,
    adapterSimulationPassed: preflight.lastAdapterSimulationPassed,
    adapterSimulationDetail: preflight.lastAdapterSimulationDetail,
  };
}

type AdapterGateFields = keyof typeof EMPTY_ADAPTER_GATE;

function failure(
  partial: Omit<DirectDemoDeliveryFailure, "ok" | AdapterGateFields | "externalCallExecuted"> &
    Partial<Pick<DirectDemoDeliveryFailure, AdapterGateFields | "externalCallExecuted">> & {
      externalCallExecuted?: boolean;
    }
): DirectDemoDeliveryFailure {
  return {
    ok: false,
    externalCallExecuted: partial.externalCallExecuted ?? false,
    ...EMPTY_ADAPTER_GATE,
    ...partial,
  };
}

function validateModeEnv(
  mode: DirectDemoDeliveryBody["mode"],
  runtime: ResolvedDeliveryRuntimeMode
): string | null {
  if (mode === "simulate") {
    if (!isGhlAdapterSimulationAllowed()) {
      const max = getGhlDeliveryAdapterMaxMode();
      return `mode=simulate requires env max mode to allow simulation (current max: ${max}).`;
    }
    return null;
  }
  if (!runtime.canRunLiveCanary) {
    return `live canary runtime mode is not active (max: ${runtime.maxAllowedMode}, effective: ${runtime.effectiveMode}). ${runtime.reason}`;
  }
  return null;
}

function validateLiveConfirmation(input: DirectDemoDeliveryBody): string[] {
  const blockers: string[] = [];
  if (input.confirmLiveDeliveryRisk !== true) {
    blockers.push("confirmLiveDeliveryRisk must be true for live_canary.");
  }
  if (input.operatorConfirmationText.trim() !== LIVE_CANARY_CONFIRMATION_TEXT) {
    blockers.push(`operatorConfirmationText must be exactly "${LIVE_CANARY_CONFIRMATION_TEXT}".`);
  }
  return blockers;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type PayloadRoutingReferences = {
  routingDryRunDecisionId: string | null;
  deliveryPlanId: string | null;
  hasReferences: boolean;
};

function extractPayloadRoutingReferences(payload: LifecycleEventSchema): PayloadRoutingReferences {
  const routing = asObject(payload.routing);
  const routingDryRunDecisionId =
    trimString(routing?.routing_dry_run_decision_id) ??
    trimString(routing?.routingDryRunDecisionId) ??
    null;
  const deliveryPlanId =
    trimString(routing?.delivery_plan_id) ?? trimString(routing?.deliveryPlanId) ?? null;
  return {
    routingDryRunDecisionId,
    deliveryPlanId,
    hasReferences: Boolean(routingDryRunDecisionId || deliveryPlanId),
  };
}

type ResolvedDirectDemoPlanContext =
  | {
      ok: true;
      routingDryRunDecisionId: string;
      matchedRuleId: string | null;
      destinationClientAccountId: string;
      destinationSubaccountIdGhl: string;
      plan: NonNullable<Awaited<ReturnType<typeof findDeliveryPlanById>>>;
      sourceKind: "selected_routing_decision" | "custom_simulation_payload";
    }
  | {
      ok: false;
      reason: string;
      blockers: string[];
      sourceKind: "selected_routing_decision" | "custom_simulation_payload";
    };

async function resolveDirectDemoPlanContext(
  input: DirectDemoDeliveryBody,
  refs: PayloadRoutingReferences,
  deps: {
    runRoutingDryRunImpl: typeof runRoutingDryRun;
    generatePlanImpl: typeof generateDirectCanaryDeliveryPlanForDecision;
    findRoutingDecisionByIdImpl: typeof findRoutingDryRunDecisionById;
    findPlanByIdImpl: typeof findDeliveryPlanById;
    findPlanByDecisionIdImpl: typeof findDeliveryPlanByRoutingDecisionId;
  }
): Promise<ResolvedDirectDemoPlanContext> {
  if (!refs.hasReferences) {
    let dryRunPayload = input.payload;
    if (isBulkImportLifecyclePayload(dryRunPayload)) {
      const intake = dryRunPayload.routing?.source_intake as
        | { destinationClientAccountId?: string }
        | undefined;
      const destinationClientAccountId =
        intake?.destinationClientAccountId?.trim() || dryRunPayload.client_account_id.trim();
      dryRunPayload = await prepareBulkImportPayloadForRoutingDryRun(
        dryRunPayload,
        destinationClientAccountId
      );
    }

    const dryRun = await deps.runRoutingDryRunImpl(dryRunPayload);
    if (!dryRun.matched) {
      return {
        ok: false,
        reason: dryRun.reason || "No routing rule matched this lead.",
        blockers: ["Routing rule did not match."],
        sourceKind: "custom_simulation_payload",
      };
    }

    const planResult = await deps.generatePlanImpl(dryRun.decisionId, {
      leadIdentity: leadIdentityFromPayload(input.payload),
      attribution: extractRoutingAttributionFromPayload(input.payload),
    });
    if ("notFound" in planResult) {
      return {
        ok: false,
        reason: "Routing decision not found after dry-run.",
        blockers: ["Could not create delivery plan."],
        sourceKind: "custom_simulation_payload",
      };
    }

    return {
      ok: true,
      routingDryRunDecisionId: dryRun.decisionId,
      matchedRuleId: dryRun.matchedRuleId ?? null,
      destinationClientAccountId: dryRun.destinationClientAccountId?.trim() ?? "",
      destinationSubaccountIdGhl: dryRun.destinationSubaccountIdGhl?.trim() ?? "",
      plan: planResult.plan as NonNullable<Awaited<ReturnType<typeof findDeliveryPlanById>>>,
      sourceKind: "custom_simulation_payload",
    };
  }

  let decision = refs.routingDryRunDecisionId
    ? await deps.findRoutingDecisionByIdImpl(refs.routingDryRunDecisionId)
    : null;
  let plan = refs.deliveryPlanId ? await deps.findPlanByIdImpl(refs.deliveryPlanId) : null;

  if (!plan && decision?.id) {
    plan = await deps.findPlanByDecisionIdImpl(decision.id);
  }
  if (!decision && plan?.routingDryRunDecisionId) {
    decision = await deps.findRoutingDecisionByIdImpl(plan.routingDryRunDecisionId);
  }

  const blockers: string[] = [];
  if (!decision?.matched) {
    blockers.push("Live canary requires a matched routing decision and delivery plan.");
  }
  if (!plan) {
    blockers.push("Live canary requires a matched routing decision and delivery plan.");
  }
  if (decision && plan && plan.routingDryRunDecisionId !== decision.id) {
    blockers.push("Delivery plan does not match the selected routing decision.");
  }

  const destinationClientAccountId =
    plan?.destinationClientAccountId?.trim() ??
    decision?.destinationClientAccountId?.trim() ??
    "";
  const destinationSubaccountIdGhl =
    plan?.destinationSubaccountIdGhl?.trim() ??
    decision?.destinationSubaccountIdGhl?.trim() ??
    "";
  if (!destinationClientAccountId || !destinationSubaccountIdGhl) {
    blockers.push("Selected routing decision/plan does not contain a destination.");
  }

  if (blockers.length > 0 || !plan || !decision) {
    return {
      ok: false,
      reason: blockers[0] ?? "Live canary requires a matched routing decision and delivery plan.",
      blockers:
        blockers.length > 0
          ? blockers
          : ["Live canary requires a matched routing decision and delivery plan."],
      sourceKind: "selected_routing_decision",
    };
  }

  return {
    ok: true,
    routingDryRunDecisionId: decision.id,
    matchedRuleId: decision.matchedRuleId ?? null,
    destinationClientAccountId,
    destinationSubaccountIdGhl,
    plan: plan as NonNullable<Awaited<ReturnType<typeof findDeliveryPlanById>>>,
    sourceKind: "selected_routing_decision",
  };
}

async function evaluateLiveCanaryDestinationApproval(input: {
  runtime: ResolvedDeliveryRuntimeMode;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  deliveryPlanId: string;
  routingDryRunDecisionId: string;
  sourceKind: "selected_routing_decision" | "custom_simulation_payload";
  duplicateRisk: DuplicateRiskAssessmentItem | null;
  findClientByIdImpl: typeof findClientAccountById;
  findLocationConnectionByIdImpl: typeof findGhlLocationConnectionByLocationId;
}): Promise<string[]> {
  const blockers: string[] = [];
  if (input.sourceKind === "custom_simulation_payload") {
    blockers.push("raw custom payload cannot run live canary");
    blockers.push("Live canary requires a matched routing decision and delivery plan.");
    return blockers;
  }
  if (!input.runtime.canRunLiveCanary) {
    blockers.push("live canary runtime mode is not active");
  }

  const client = await input.findClientByIdImpl(input.destinationClientAccountId);
  const destination = client?.ghlDestination;
  if (!destination) {
    blockers.push("delivery mode must be live");
    blockers.push("delivery enabled is false");
    blockers.push("client cutover approved is false");
    blockers.push("internal approval status must be approved");
    blockers.push("destination OAuth is not connected");
    blockers.push("SA360 required fields are not installed/mapped");
  } else {
    if (destination.deliveryMode !== "live") {
      blockers.push("delivery mode must be live");
    }
    if (destination.deliveryEnabled !== true) {
      blockers.push("delivery enabled is false");
    }
    if (destination.clientCutoverApproved !== true) {
      blockers.push("client cutover approved is false");
    }
    if (destination.internalApprovalStatus !== "approved") {
      blockers.push("internal approval status must be approved");
    }
    const connection = await input.findLocationConnectionByIdImpl(input.destinationSubaccountIdGhl);
    const readiness = evaluateDestinationReadiness(
      destinationInputFromGhlDestination(
        {
          clientAccountId: input.destinationClientAccountId,
          clientDisplayName: client?.clientDisplayName ?? input.destinationClientAccountId,
        },
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
    if (!readiness.readyForSimulation) {
      blockers.push("destination OAuth is not connected");
    }
    const requiredFieldsInstalled = destination.requiredFieldsInstalled === true;
    const mappedCoreFields =
      readiness.fieldMapping.coreRequiredMissing.length === 0 &&
      readiness.fieldMapping.coreRequiredComplete;
    if (!requiredFieldsInstalled || !mappedCoreFields) {
      blockers.push("SA360 required fields are not installed/mapped");
    }
  }

  const allowlist = isDestinationAllowedForLiveCanary(
    input.destinationClientAccountId,
    input.destinationSubaccountIdGhl
  );
  if (allowlist.configured && !allowlist.allowed) {
    blockers.push("destination not in live canary allowlist");
  }

  if (input.duplicateRisk?.blocksLiveDelivery) {
    blockers.push(
      input.duplicateRisk.recommendedAction ||
        `Duplicate risk (${input.duplicateRisk.riskLevel}) blocks live delivery.`
    );
  }

  return blockers;
}

export async function runDirectDemoDelivery(
  input: DirectDemoDeliveryBody,
  deps: DirectDemoDeliveryDeps = {}
): Promise<DirectDemoDeliveryResult> {
  const mode = input.mode;
  const warnings: string[] = [];
  const runDryRun = deps.runRoutingDryRun ?? runRoutingDryRun;
  const generatePlan =
    deps.generateDirectCanaryDeliveryPlanForDecision ??
    generateDirectCanaryDeliveryPlanForDecision;
  const simulatePlan = deps.runGhlAdapterSimulationForPlan ?? runGhlAdapterSimulationForPlan;
  const preflightPlan = deps.getLiveCanaryPreflightForPlan ?? getLiveCanaryPreflightForPlan;
  const executeLive = deps.executeLiveCanaryForPlan ?? executeLiveCanaryForPlan;
  const findRule = deps.findCampaignRoutingRuleById ?? findCampaignRoutingRuleById;
  const getDuplicateRisk = deps.getDuplicateRiskForRoutingDecision ?? getDuplicateRiskForRoutingDecision;
  const findRoutingDecisionById = deps.findRoutingDryRunDecisionById ?? findRoutingDryRunDecisionById;
  const findPlanById = deps.findDeliveryPlanById ?? findDeliveryPlanById;
  const findPlanByDecisionId =
    deps.findDeliveryPlanByRoutingDecisionId ?? findDeliveryPlanByRoutingDecisionId;
  const findClientById = deps.findClientAccountById ?? findClientAccountById;
  const findLocationConnectionById =
    deps.findGhlLocationConnectionByLocationId ?? findGhlLocationConnectionByLocationId;

  const runtimeMode = await warmEffectiveDeliveryAdapterMode();
  const modeError = validateModeEnv(mode, runtimeMode);
  if (modeError) {
    return failure({
      error: "delivery_blocked",
      reason: modeError,
      mode,
      matched: false,
      destinationClientAccountId: null,
      destinationSubaccountIdGhl: null,
      routingDryRunDecisionId: null,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: [modeError],
      warnings,
      nextAction: "Set adapter max/runtime mode before retrying.",
    });
  }

  if (input.payload.event.event_name_internal !== "lead_created") {
    return failure({
      error: "delivery_blocked",
      reason: "Only lead_created events can be delivered via direct demo.",
      mode,
      matched: false,
      destinationClientAccountId: null,
      destinationSubaccountIdGhl: null,
      routingDryRunDecisionId: null,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: ["event_name_internal must be lead_created."],
      warnings,
      nextAction: "Send a lead_created lifecycle payload.",
    });
  }

  if (mode === "live_canary") {
    const confirmBlockers = validateLiveConfirmation(input);
    if (confirmBlockers.length > 0) {
      return failure({
        error: "delivery_blocked",
        reason: confirmBlockers[0]!,
        mode,
        matched: false,
        destinationClientAccountId: null,
        destinationSubaccountIdGhl: null,
        routingDryRunDecisionId: null,
        deliveryPlanId: null,
        adapterRunId: null,
        liveRunId: null,
        blockers: confirmBlockers,
        warnings,
        nextAction: `Type "${LIVE_CANARY_CONFIRMATION_TEXT}" and confirm live delivery risk.`,
      });
    }
  }

  const refs = extractPayloadRoutingReferences(input.payload);
  if (mode === "live_canary" && !refs.hasReferences) {
    return failure({
      error: "delivery_blocked",
      reason: "Live canary requires a matched routing decision and delivery plan.",
      mode,
      matched: false,
      destinationClientAccountId: null,
      destinationSubaccountIdGhl: null,
      routingDryRunDecisionId: null,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: [
        "raw custom payload cannot run live canary",
        "Live canary requires a matched routing decision and delivery plan.",
      ],
      warnings,
      nextAction: "Select a matched routing decision with a delivery plan, or run simulation only.",
    });
  }

  let planContext: ResolvedDirectDemoPlanContext;
  try {
    planContext = await resolveDirectDemoPlanContext(input, refs, {
      runRoutingDryRunImpl: runDryRun,
      generatePlanImpl: generatePlan,
      findRoutingDecisionByIdImpl: findRoutingDecisionById,
      findPlanByIdImpl: findPlanById,
      findPlanByDecisionIdImpl: findPlanByDecisionId,
    });
  } catch (err) {
    return failure({
      error: "delivery_blocked",
      reason: err instanceof Error ? err.message : "Routing dry-run failed.",
      mode,
      matched: false,
      destinationClientAccountId: null,
      destinationSubaccountIdGhl: null,
      routingDryRunDecisionId: null,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: ["Routing dry-run failed."],
      warnings,
      nextAction: "Fix payload and routing configuration, then retry.",
    });
  }

  if (!planContext.ok) {
    return failure({
      error: "delivery_blocked",
      reason: planContext.reason,
      mode,
      matched: false,
      destinationClientAccountId: null,
      destinationSubaccountIdGhl: null,
      routingDryRunDecisionId: refs.routingDryRunDecisionId,
      deliveryPlanId: refs.deliveryPlanId,
      adapterRunId: null,
      liveRunId: null,
      blockers: planContext.blockers,
      warnings,
      nextAction:
        planContext.sourceKind === "selected_routing_decision"
          ? "Select a matched routing decision with a valid delivery plan."
          : "Seed or activate a routing rule and generate a delivery plan before retrying.",
    });
  }

  const plan = planContext.plan;
  const destClient = planContext.destinationClientAccountId;
  const destLocation = planContext.destinationSubaccountIdGhl;
  const routingDryRunDecisionId = planContext.routingDryRunDecisionId;
  const matchedRuleId = planContext.matchedRuleId;

  const { sourceLane, sourceLaneLabel } = inferDirectDemoSourceLane(input.payload);
  const duplicateRiskRaw = await getDuplicateRisk(routingDryRunDecisionId);
  const duplicateRisk = presentDuplicateRiskForDirectDemo(duplicateRiskRaw);

  if (mode === "live_canary") {
    const liveApprovalBlockers = await evaluateLiveCanaryDestinationApproval({
      runtime: runtimeMode,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      deliveryPlanId: plan.id,
      routingDryRunDecisionId,
      sourceKind: planContext.sourceKind,
      duplicateRisk,
      findClientByIdImpl: findClientById,
      findLocationConnectionByIdImpl: findLocationConnectionById,
    });
    if (liveApprovalBlockers.length > 0) {
      return failure({
        error: "delivery_blocked",
        reason: liveApprovalBlockers[0]!,
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: null,
        liveRunId: null,
        blockers: liveApprovalBlockers,
        warnings,
        nextAction: "Resolve remaining blockers before live canary.",
      });
    }
  }

  const rule = matchedRuleId ? await findRule(matchedRuleId) : null;
  const clientAccount =
    rule?.clientAccountId ? await findClientById(rule.clientAccountId) : null;
  const destinationMapping = clientDestinationFieldMappingFromDest(
    clientAccount?.ghlDestination
  );
  const readiness = rule
    ? evaluateDeliveryReadiness(ruleToReadinessInput(rule, destinationMapping))
    : null;
  const matchedRuleSummary = directDemoMatchedRuleSummary(rule);
  const fieldMappingSource = readiness?.fieldMapping?.source ?? null;

  const planDiagnostics = collectDirectCanaryPlanDiagnostics(plan);
  const planType =
    mode === "live_canary"
      ? DELIVERY_PLAN_TYPES.LIVE_CANARY
      : planDiagnostics.planType;

  if (BLOCKED_PLAN_STATUSES.has(plan.status)) {
    const planBlockers = formatDirectCanaryPlanBlockers(
      planDiagnostics,
      directDemoMatchedRuleSummary(rule)
    );
    return failure({
      error: "delivery_blocked",
      reason: `Adapter plan status is ${plan.status} (path: ${planDiagnostics.planPath}).`,
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId,
      deliveryPlanId: plan.id,
      adapterRunId: null,
      liveRunId: null,
      blockers: planBlockers,
      warnings: [
        ...warnings,
        ...(Array.isArray(plan.warnings)
          ? plan.warnings.filter((w): w is string => typeof w === "string")
          : []),
      ],
      nextAction:
        planDiagnostics.missingConfigFields.length > 0
          ? `Resolve missing adapter config: ${planDiagnostics.missingConfigFields.join(", ")}.`
          : "Review adapter plan step issues and destination readiness.",
      matchedRuleId,
      matchedRuleSummary,
      fieldMappingSource,
      readiness,
      deliveryPlanStatus: plan.status,
      planType,
      planPath: planDiagnostics.planPath,
      missingConfigFields: planDiagnostics.missingConfigFields,
    });
  }

  if (duplicateRisk?.blocksLiveDelivery) {
    if (mode === "live_canary") {
      return failure({
        error: "delivery_blocked",
        reason:
          duplicateRisk.recommendedAction ||
          `Duplicate risk (${duplicateRisk.riskLevel}) blocks live delivery.`,
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: null,
        liveRunId: null,
        blockers: [
          duplicateRisk.recommendedAction ||
            `Duplicate risk (${duplicateRisk.riskLevel}) blocks live delivery.`,
        ],
        warnings,
        nextAction: "Resolve duplicate risk in Admin C.O.C. before live canary.",
      });
    }
    warnings.push(
      recommendedActionForDirectDemo(duplicateRisk.recommendedAction) ||
        duplicateRisk.recommendedAction ||
        `Duplicate risk (${duplicateRisk.riskLevel}) noted — live delivery would be blocked.`
    );
  }

  if (duplicateRisk?.identityStatus === "orphan_appointment" && mode === "live_canary") {
    return failure({
      error: "delivery_blocked",
      reason: "Orphan appointment detected; live delivery blocked.",
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId,
      deliveryPlanId: plan.id,
      adapterRunId: null,
      liveRunId: null,
      blockers: ["Orphan appointment detected."],
      warnings,
      nextAction: "Review duplicate risk before live delivery.",
    });
  }

  if (mode === "simulate") {
    const sim = await simulatePlan(plan.id, { checkLiveReadiness: true });
    if ("notFound" in sim) {
      return failure({
        error: "delivery_blocked",
        reason: "Delivery plan not found for adapter simulation.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: null,
        liveRunId: null,
        blockers: ["Adapter simulation could not load plan."],
        warnings,
        nextAction: "Retry simulation.",
      });
    }

    if (!sim.ok) {
      return failure({
        error: "delivery_blocked",
        reason: sim.blockedReason || "GHL adapter simulation did not pass.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: sim.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: [sim.blockedReason || "Adapter simulation blocked."],
        warnings,
        nextAction: "Fix adapter validation blockers and retry simulation.",
      });
    }

    return {
      ok: true,
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId,
      deliveryPlanId: plan.id,
      adapterRunId: sim.adapterRun?.id ?? null,
      liveRunId: null,
      externalCallExecuted: false,
      summary: sim.adapterRun?.summary ?? "GHL adapter simulation completed (no external writes).",
      blockers: [],
      warnings,
      nextAction:
        "Review simulation output. For one live test, set live_canary mode with operator confirmation.",
      matchedRuleId,
      matchedRuleSummary,
      fieldMappingSource,
      duplicateRisk,
      readiness,
      deliveryPlanStatus: plan.status,
      planType,
      planPath: planDiagnostics.planPath,
      missingConfigFields: planDiagnostics.missingConfigFields,
      adapterMode: getGhlDeliveryAdapterMode(),
      latestAdapterRunId: sim.adapterRun?.id ?? null,
      latestAdapterRunStatus: sim.adapterRun?.status ?? "simulated",
      latestAdapterRunMode: "simulate",
      adapterSimulationPassed: true,
      adapterSimulationDetail:
        "Adapter simulation completed for this deliveryPlanId (no external writes).",
      sourceLane,
      sourceLaneLabel,
    };
  }

  if (mode === "live_canary") {
    const simBeforeLive = await simulatePlan(plan.id, { checkLiveReadiness: true });
    if ("notFound" in simBeforeLive || !simBeforeLive.ok) {
      const simulationBlocker = "no successful simulation for this delivery plan";
      const simulationDetail =
        ("notFound" in simBeforeLive ? null : simBeforeLive.blockedReason) ??
        "Adapter simulation must pass immediately before live canary.";
      return failure({
        error: "delivery_blocked",
        reason: simulationDetail,
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: "notFound" in simBeforeLive ? null : simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: [simulationBlocker, simulationDetail],
        warnings,
        nextAction: "Fix simulation blockers, then retry live canary.",
      });
    }

    const preflight = await preflightPlan(plan.id);
    if ("notFound" in preflight) {
      return failure({
        error: "delivery_blocked",
        reason: "Delivery plan not found for live canary preflight.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: ["Live canary preflight could not load plan."],
        warnings,
        nextAction: "Retry live canary.",
      });
    }

    if (!preflight.preflight.canExecute) {
      const simGate = adapterGateFromPreflight(preflight.preflight);
      const simBlocker = preflight.preflight.blockers.find((b) =>
        b.includes("Recent successful GHL adapter simulation")
      );
      const preflightBlockers = simBlocker
        ? ["no successful simulation for this delivery plan", ...preflight.preflight.blockers]
        : preflight.preflight.blockers;
      return failure({
        error: "delivery_blocked",
        reason: preflight.preflight.blockers[0] || "Live canary preflight blocked.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: preflightBlockers,
        warnings: [...warnings, ...preflight.preflight.warnings],
        nextAction: simBlocker
          ? "Adapter simulation for this deliveryPlanId must pass immediately before live canary; fix validation blockers and retry."
          : "Resolve preflight blockers (readiness, OAuth, idempotency) before live canary.",
        ...simGate,
      });
    }

    const live = await executeLive(plan.id, {
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: input.operatorConfirmationText.trim(),
      executedBy: "direct_demo_api",
      lifecyclePayload: input.payload,
    });

    if ("notFound" in live) {
      return failure({
        error: "delivery_blocked",
        reason: "Delivery plan not found for live canary execution.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: ["Live canary execution could not load plan."],
        warnings,
        nextAction: "Retry live canary.",
      });
    }

    if ("blocked" in live) {
      return failure({
        error: "delivery_blocked",
        reason: live.blockers?.[0] || "Live canary blocked.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: live.blockers ?? [],
        warnings,
        nextAction: "Resolve live canary blockers and retry.",
      });
    }

    if ("skippedDuplicate" in live) {
      return failure({
        error: "delivery_blocked",
        reason: "A succeeded live delivery already exists for this idempotency key.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: live.liveRun?.id ?? null,
        blockers: ["Idempotency key already succeeded — delivery skipped."],
        warnings,
        nextAction: "Use a new lead_uid / event_uuid for another live test.",
      });
    }

    const liveRunStatus = live.liveRun?.status ?? null;
    const externalCallExecuted = live.externalCallExecuted ?? false;

    const liveRunStepSummary = summarizeLiveCanaryStepsFromRun(live.liveRun);

    if (!live.ok) {
      const liveRunFailure = summarizeLiveCanaryFailureFromRun(live.liveRun);
      const isContactFailure = liveRunFailure?.failedStepType === "create_or_update_contact";
      const isPartialSuccess = liveRunStatus === "partial_success";
      const partialRequiredPathComplete =
        isPartialSuccess &&
        (live.liveRun?.summary?.includes("Optional enrichment needs config") ||
          live.liveRun?.summary === DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY);
      const failureBlockers = partialRequiredPathComplete
        ? []
        : [
            liveRunFailure?.errorMessage,
            ...(Array.isArray(live.liveRun?.errors) ? live.liveRun.errors : []),
          ].filter((b): b is string => typeof b === "string" && b.trim().length > 0);

      return failure({
        error: isPartialSuccess ? "live_canary_partial_failure" : "live_canary_failed",
        reason:
          live.liveRun?.summary ??
          (isContactFailure
            ? "Contact creation failed; downstream steps were skipped."
            : isPartialSuccess
              ? DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY
              : "Live canary execution failed."),
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: live.liveRun?.id ?? null,
        externalCallExecuted,
        blockers: failureBlockers.length
          ? failureBlockers
          : partialRequiredPathComplete
            ? []
            : ["Live canary execution failed after external GHL write was attempted."],
        warnings: [...warnings, ...(Array.isArray(live.liveRun?.warnings) ? live.liveRun.warnings : [])],
        nextAction: isContactFailure
          ? "Review the sanitized GHL error below, fix contact payload/field mapping, then retry with a new lead_uid/event_uuid."
          : partialRequiredPathComplete
            ? "Required contact, tags, and opportunity succeeded. Configure owner, workflow, and custom field mapping as needed."
            : isPartialSuccess
              ? "Review step summary below. Fix opportunity/field config, then retry with a new lead_uid/event_uuid."
              : "Inspect live run step errors in Admin C.O.C., verify GHL subaccount state, then retry with a new lead_uid/event_uuid if needed.",
        latestAdapterRunId: simBeforeLive.adapterRun?.id ?? null,
        latestAdapterRunStatus: "simulated",
        latestAdapterRunMode: "simulate",
        adapterSimulationPassed: true,
        adapterSimulationDetail:
          "Shadow adapter simulation passed for this deliveryPlanId immediately before live canary.",
        liveRunStatus,
        liveRunFailure,
        liveRunStepSummary,
        contactIdGhl: live.contactIdGhl ?? live.liveRun?.contactIdGhl ?? null,
        opportunityIdGhl: live.opportunityIdGhl ?? live.liveRun?.opportunityIdGhl ?? null,
        matchedRuleId,
        matchedRuleSummary,
        fieldMappingSource,
        duplicateRisk,
        readiness,
        deliveryPlanStatus: plan.status,
        adapterMode: getGhlDeliveryAdapterMode(),
        sourceLane,
        sourceLaneLabel,
      });
    }

    return {
      ok: true,
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId,
      deliveryPlanId: plan.id,
      adapterRunId: simBeforeLive.adapterRun?.id ?? null,
      liveRunId: live.liveRun?.id ?? null,
      externalCallExecuted,
      summary:
        liveRunStatus === "succeeded"
          ? DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY
          : (live.liveRun?.summary ?? "Live canary execution finished."),
      blockers: [],
      warnings: [...warnings, ...(Array.isArray(live.liveRun?.warnings) ? live.liveRun.warnings : [])],
      nextAction: "Verify contact/opportunity in Smart Agent 360 Demo GHL subaccount.",
      matchedRuleId,
      matchedRuleSummary,
      fieldMappingSource,
      duplicateRisk,
      readiness,
      deliveryPlanStatus: plan.status,
      planType,
      planPath: planDiagnostics.planPath,
      missingConfigFields: planDiagnostics.missingConfigFields,
      adapterMode: getGhlDeliveryAdapterMode(),
      latestAdapterRunId: simBeforeLive.adapterRun?.id ?? null,
      latestAdapterRunStatus: "simulated",
      latestAdapterRunMode: "simulate",
      adapterSimulationPassed: true,
      adapterSimulationDetail:
        "Shadow adapter simulation passed for this deliveryPlanId immediately before live canary.",
      liveRunStatus,
      liveRunFailure: null,
      liveRunStepSummary,
      contactIdGhl: live.contactIdGhl ?? live.liveRun?.contactIdGhl ?? null,
      opportunityIdGhl: live.opportunityIdGhl ?? live.liveRun?.opportunityIdGhl ?? null,
      sourceLane,
      sourceLaneLabel,
    };
  }

  return failure({
    error: "delivery_blocked",
    reason: "Unsupported delivery mode.",
    mode,
    matched: true,
    destinationClientAccountId: destClient,
    destinationSubaccountIdGhl: destLocation,
    routingDryRunDecisionId,
    deliveryPlanId: plan.id,
    adapterRunId: null,
    liveRunId: null,
    blockers: [`Unsupported mode: ${mode}`],
    warnings,
    nextAction: "Use simulate or live_canary mode.",
  });
}
