import type { CampaignRoutingRule } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  extractRoutingAttributionFromPayload,
  type RoutingAttributionInput,
} from "../../lib/routing-attribution-extract.js";
import {
  getGhlDeliveryAdapterMode,
  isGhlAdapterSimulationAllowed,
  isGhlLiveCanaryMode,
  LIVE_CANARY_CONFIRMATION_TEXT,
} from "../../lib/ghl-delivery-adapter-mode.js";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
  isDirectDemoDestinationAllowed,
  isDirectLiveDeliveryEnvConfigured,
} from "../../lib/direct-demo-delivery-config.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
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
  generateLeadDeliveryPlanForDecision,
} from "../lead-delivery-plan.service.js";
import { evaluateDeliveryReadiness } from "../delivery-readiness.service.js";
import { DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY } from "../ghl-delivery-adapter/ghl-live-canary-step-requirements.js";
import {
  clientDestinationFieldMappingFromDest,
  ruleToReadinessInput,
} from "../delivery-readiness-admin.present.js";
import type { RoutingDryRunLeadIdentity } from "../routing-dry-run-admin.present.js";
import { runRoutingDryRun } from "../routing-dry-run.service.js";

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
  adapterMode?: string | null;
};

export type DirectDemoDeliveryResult = DirectDemoDeliverySuccess | DirectDemoDeliveryFailure;

export type DirectDemoDeliveryDeps = {
  runRoutingDryRun?: typeof runRoutingDryRun;
  generateLeadDeliveryPlanForDecision?: typeof generateLeadDeliveryPlanForDecision;
  runGhlAdapterSimulationForPlan?: typeof runGhlAdapterSimulationForPlan;
  getLiveCanaryPreflightForPlan?: typeof getLiveCanaryPreflightForPlan;
  executeLiveCanaryForPlan?: typeof executeLiveCanaryForPlan;
  findCampaignRoutingRuleById?: typeof findCampaignRoutingRuleById;
  getDuplicateRiskForRoutingDecision?: typeof getDuplicateRiskForRoutingDecision;
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

function validateModeEnv(mode: DirectDemoDeliveryBody["mode"]): string | null {
  if (mode === "simulate") {
    if (!isGhlAdapterSimulationAllowed()) {
      return "mode=simulate requires GHL_DELIVERY_ADAPTER_MODE=simulate, readonly_probe, or live_canary.";
    }
    return null;
  }
  if (!isGhlLiveCanaryMode()) {
    return "mode=live_canary requires GHL_DELIVERY_ADAPTER_MODE=live_canary.";
  }
  if (!isDirectLiveDeliveryEnvConfigured()) {
    return "Direct live delivery is disabled until SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS and SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS are set.";
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

export async function runDirectDemoDelivery(
  input: DirectDemoDeliveryBody,
  deps: DirectDemoDeliveryDeps = {}
): Promise<DirectDemoDeliveryResult> {
  const mode = input.mode;
  const warnings: string[] = [];
  const runDryRun = deps.runRoutingDryRun ?? runRoutingDryRun;
  const generatePlan = deps.generateLeadDeliveryPlanForDecision ?? generateLeadDeliveryPlanForDecision;
  const simulatePlan = deps.runGhlAdapterSimulationForPlan ?? runGhlAdapterSimulationForPlan;
  const preflightPlan = deps.getLiveCanaryPreflightForPlan ?? getLiveCanaryPreflightForPlan;
  const executeLive = deps.executeLiveCanaryForPlan ?? executeLiveCanaryForPlan;
  const findRule = deps.findCampaignRoutingRuleById ?? findCampaignRoutingRuleById;
  const getDuplicateRisk = deps.getDuplicateRiskForRoutingDecision ?? getDuplicateRiskForRoutingDecision;

  const modeError = validateModeEnv(mode);
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
      nextAction: "Set adapter mode and direct delivery env vars before retrying.",
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

  let dryRun;
  try {
    dryRun = await runDryRun(input.payload);
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

  if (!dryRun.matched) {
    return failure({
      error: "delivery_blocked",
      reason: dryRun.reason || "No routing rule matched this lead.",
      mode,
      matched: false,
      destinationClientAccountId: dryRun.destinationClientAccountId ?? null,
      destinationSubaccountIdGhl: dryRun.destinationSubaccountIdGhl ?? null,
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: ["Routing rule did not match."],
      warnings,
      nextAction: "Seed or activate a routing rule for the Smart Agent 360 Demo destination.",
    });
  }

  const destClient = dryRun.destinationClientAccountId?.trim() ?? "";
  const destLocation = dryRun.destinationSubaccountIdGhl?.trim() ?? "";

  if (!isDirectDemoDestinationAllowed(destClient, destLocation)) {
    return failure({
      error: "delivery_blocked",
      reason: `Destination ${destClient}/${destLocation} is not on the direct demo allowlist.`,
      mode,
      matched: true,
      destinationClientAccountId: destClient || null,
      destinationSubaccountIdGhl: destLocation || null,
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: [
        `Allowed demo client: ${DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID}; allowed location: ${DIRECT_DEMO_CANONICAL_LOCATION_ID}.`,
      ],
      warnings,
      nextAction: "Update routing rule destination or SA360_DIRECT_DELIVERY_ALLOWED_* env vars.",
    });
  }

  const attribution: RoutingAttributionInput = extractRoutingAttributionFromPayload(input.payload);
  const leadIdentity = leadIdentityFromPayload(input.payload);

  const planResult = await generatePlan(dryRun.decisionId, { leadIdentity, attribution });
  if ("notFound" in planResult) {
    return failure({
      error: "delivery_blocked",
      reason: "Routing decision not found after dry-run.",
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: null,
      adapterRunId: null,
      liveRunId: null,
      blockers: ["Could not create delivery plan."],
      warnings,
      nextAction: "Retry direct delivery or inspect routing decision in Admin C.O.C.",
    });
  }

  const plan = planResult.plan;
  const duplicateRisk = await getDuplicateRisk(dryRun.decisionId);

  const rule = dryRun.matchedRuleId ? await findRule(dryRun.matchedRuleId) : null;
  const clientAccount =
    rule?.clientAccountId ? await findClientAccountById(rule.clientAccountId) : null;
  const destinationMapping = clientDestinationFieldMappingFromDest(
    clientAccount?.ghlDestination
  );
  const readiness = rule
    ? evaluateDeliveryReadiness(ruleToReadinessInput(rule, destinationMapping))
    : null;
  const matchedRuleSummary = directDemoMatchedRuleSummary(rule);
  const fieldMappingSource = readiness?.fieldMapping?.source ?? null;

  if (BLOCKED_PLAN_STATUSES.has(plan.status)) {
    return failure({
      error: "delivery_blocked",
      reason: `Delivery plan status is ${plan.status}.`,
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: plan.id,
      adapterRunId: null,
      liveRunId: null,
      blockers: [`Delivery plan status is ${plan.status}.`],
      warnings: Array.isArray(plan.warnings)
        ? plan.warnings.filter((w): w is string => typeof w === "string")
        : [],
      nextAction: "Complete delivery readiness and routing config before delivery.",
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
        routingDryRunDecisionId: dryRun.decisionId,
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
      routingDryRunDecisionId: dryRun.decisionId,
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
        routingDryRunDecisionId: dryRun.decisionId,
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
        routingDryRunDecisionId: dryRun.decisionId,
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
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: plan.id,
      adapterRunId: sim.adapterRun?.id ?? null,
      liveRunId: null,
      externalCallExecuted: false,
      summary: sim.adapterRun?.summary ?? "GHL adapter simulation completed (no external writes).",
      blockers: [],
      warnings,
      nextAction:
        "Review simulation output. For one live test, set live_canary mode with operator confirmation.",
      matchedRuleId: dryRun.matchedRuleId ?? null,
      matchedRuleSummary,
      fieldMappingSource,
      duplicateRisk,
      readiness,
      deliveryPlanStatus: plan.status,
      adapterMode: getGhlDeliveryAdapterMode(),
      latestAdapterRunId: sim.adapterRun?.id ?? null,
      latestAdapterRunStatus: sim.adapterRun?.status ?? "simulated",
      latestAdapterRunMode: "simulate",
      adapterSimulationPassed: true,
      adapterSimulationDetail:
        "Adapter simulation completed for this deliveryPlanId (no external writes).",
    };
  }

  if (mode === "live_canary") {
    const simBeforeLive = await simulatePlan(plan.id, { checkLiveReadiness: true });
    if ("notFound" in simBeforeLive || !simBeforeLive.ok) {
      return failure({
        error: "delivery_blocked",
        reason:
          ("notFound" in simBeforeLive ? null : simBeforeLive.blockedReason) ||
          "Adapter simulation must pass immediately before live canary.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId: dryRun.decisionId,
        deliveryPlanId: plan.id,
        adapterRunId: "notFound" in simBeforeLive ? null : simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: [
          ("notFound" in simBeforeLive ? null : simBeforeLive.blockedReason) ||
            "Run a successful adapter simulation before live canary.",
        ],
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
        routingDryRunDecisionId: dryRun.decisionId,
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
      return failure({
        error: "delivery_blocked",
        reason: preflight.preflight.blockers[0] || "Live canary preflight blocked.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId: dryRun.decisionId,
        deliveryPlanId: plan.id,
        adapterRunId: simBeforeLive.adapterRun?.id ?? null,
        liveRunId: null,
        blockers: preflight.preflight.blockers,
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
    });

    if ("notFound" in live) {
      return failure({
        error: "delivery_blocked",
        reason: "Delivery plan not found for live canary execution.",
        mode,
        matched: true,
        destinationClientAccountId: destClient,
        destinationSubaccountIdGhl: destLocation,
        routingDryRunDecisionId: dryRun.decisionId,
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
        routingDryRunDecisionId: dryRun.decisionId,
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
        routingDryRunDecisionId: dryRun.decisionId,
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
        (live.liveRun?.summary?.includes("required delivery completed") ||
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
        routingDryRunDecisionId: dryRun.decisionId,
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
        matchedRuleId: dryRun.matchedRuleId ?? null,
        matchedRuleSummary,
        fieldMappingSource,
        duplicateRisk,
        readiness,
        deliveryPlanStatus: plan.status,
        adapterMode: getGhlDeliveryAdapterMode(),
      });
    }

    return {
      ok: true,
      mode,
      matched: true,
      destinationClientAccountId: destClient,
      destinationSubaccountIdGhl: destLocation,
      routingDryRunDecisionId: dryRun.decisionId,
      deliveryPlanId: plan.id,
      adapterRunId: simBeforeLive.adapterRun?.id ?? null,
      liveRunId: live.liveRun?.id ?? null,
      externalCallExecuted,
      summary: live.liveRun?.summary ?? "Live canary execution finished.",
      blockers: [],
      warnings: [...warnings, ...(Array.isArray(live.liveRun?.warnings) ? live.liveRun.warnings : [])],
      nextAction: "Verify contact/opportunity in Smart Agent 360 Demo GHL subaccount.",
      matchedRuleId: dryRun.matchedRuleId ?? null,
      matchedRuleSummary,
      fieldMappingSource,
      duplicateRisk,
      readiness,
      deliveryPlanStatus: plan.status,
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
    };
  }

  return failure({
    error: "delivery_blocked",
    reason: "Unsupported delivery mode.",
    mode,
    matched: true,
    destinationClientAccountId: destClient,
    destinationSubaccountIdGhl: destLocation,
    routingDryRunDecisionId: dryRun.decisionId,
    deliveryPlanId: plan.id,
    adapterRunId: null,
    liveRunId: null,
    blockers: [`Unsupported mode: ${mode}`],
    warnings,
    nextAction: "Use simulate or live_canary mode.",
  });
}
