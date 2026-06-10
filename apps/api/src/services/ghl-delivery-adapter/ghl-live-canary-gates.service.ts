import type { CampaignRoutingRule, LeadDeliveryPlan, RoutingDryRunDecision } from "@prisma/client";
import {
  getGhlDeliveryAdapterMode,
  isGhlLiveCanaryMode,
  LIVE_CANARY_CONFIRMATION_TEXT,
} from "../../lib/ghl-delivery-adapter-mode.js";
import { findLatestGhlAdapterRunForPlan } from "../../repositories/ghl-delivery-adapter-run.repository.js";
import { findRoutingDryRunDecisionById } from "../../repositories/routing-dry-run-decision.repository.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import {
  findGhlLiveDeliveryRunByIdempotencyKey,
  findLatestGhlLiveDeliveryRunForPlan,
  describeAdapterSimulationGate,
  isAdapterSimulationPassedForLiveCanary,
} from "../../repositories/ghl-live-delivery-run.repository.js";
import { assertLiveDeliveryAllowed, LiveDeliveryNotAllowedError } from "../delivery-guard.js";
import { ruleToReadinessInput } from "../delivery-readiness-admin.present.js";
import { getDuplicateRiskForRoutingDecision } from "../lead-identity/lead-identity-correlation.service.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { buildLiveCanaryIdempotencyKey } from "./ghl-live-transport.js";

export type LiveCanaryPreflightResult = {
  canExecute: boolean;
  blockers: string[];
  warnings: string[];
  adapterMode: string;
  idempotencyKey: string;
  lastAdapterSimulationRunId: string | null;
  lastAdapterSimulationStatus: string | null;
  lastAdapterSimulationMode: string | null;
  lastAdapterSimulationPassed: boolean;
  lastAdapterSimulationDetail: string;
  lastLiveRunStatus: string | null;
  duplicateRiskLevel: string | null;
  duplicateBlocksLive: boolean;
  readinessCanDeliverLive: boolean;
};

export type LiveCanaryExecuteInput = {
  confirmLiveDeliveryRisk: boolean;
  operatorConfirmationText: string;
  executedBy?: string | null;
};

const BLOCKED_PLAN_STATUSES = new Set(["blocked", "needs_config"]);

export async function loadLiveCanaryContext(plan: LeadDeliveryPlan & { steps: unknown[] }) {
  let decision: RoutingDryRunDecision | null = null;
  let rule: CampaignRoutingRule | null = null;

  if (plan.routingDryRunDecisionId) {
    decision = await findRoutingDryRunDecisionById(plan.routingDryRunDecisionId);
    if (decision?.matchedRuleId) {
      rule = await findCampaignRoutingRuleById(decision.matchedRuleId);
    }
  }

  const duplicateRisk = plan.routingDryRunDecisionId
    ? await getDuplicateRiskForRoutingDecision(plan.routingDryRunDecisionId)
    : null;

  const adapterRun = await findLatestGhlAdapterRunForPlan(plan.id);
  const idempotencyKey = buildLiveCanaryIdempotencyKey({
    deliveryPlanId: plan.id,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    sourceLeadUid: plan.sourceLeadUid,
    sourceEmail: plan.sourceEmail,
    sourcePhoneE164: plan.sourcePhoneE164,
    planVersion: plan.planVersion,
  });

  const priorRun = await findGhlLiveDeliveryRunByIdempotencyKey(idempotencyKey);
  const priorSucceededRun = priorRun?.status === "succeeded" ? priorRun : null;
  const latestLiveRun = await findLatestGhlLiveDeliveryRunForPlan(plan.id);

  const clientAccount = plan.destinationClientAccountId
    ? await findClientAccountById(plan.destinationClientAccountId)
    : null;
  const destinationFieldMapping = clientAccount?.ghlDestination
    ? {
        sa360CustomFieldIdMapJson: clientAccount.ghlDestination.sa360CustomFieldIdMapJson,
        customFieldStampRequired: clientAccount.ghlDestination.customFieldStampRequired,
        ownerAssignmentRequired: clientAccount.ghlDestination.ownerAssignmentRequired,
        workflowStartRequired: clientAccount.ghlDestination.workflowStartRequired,
      }
    : null;

  return {
    plan,
    decision,
    rule,
    duplicateRisk,
    adapterRun,
    idempotencyKey,
    priorSucceededRun,
    latestLiveRun,
    destinationFieldMapping,
  };
}

export async function evaluateLiveCanaryPreflight(
  plan: LeadDeliveryPlan & { steps: unknown[] }
): Promise<LiveCanaryPreflightResult> {
  const ctx = await loadLiveCanaryContext(plan);
  const blockers: string[] = [];
  const warnings: string[] = [];

  const adapterMode = getGhlDeliveryAdapterMode();
  if (!isGhlLiveCanaryMode()) {
    blockers.push("GHL_DELIVERY_ADAPTER_MODE must be live_canary.");
  }

  if (!ctx.decision?.matched) {
    blockers.push("Routing decision is unmatched; live canary cannot run.");
  }
  if (ctx.decision?.routingEventNameInternal === "routing_review_required") {
    blockers.push("Routing decision requires review; live canary cannot run.");
  }

  if (BLOCKED_PLAN_STATUSES.has(plan.status)) {
    blockers.push(`Delivery plan status is ${plan.status}.`);
  }

  if (!ctx.rule) {
    blockers.push("Matched routing rule not found for this plan.");
  }

  let readinessCanDeliverLive = false;
  if (ctx.rule) {
    try {
      assertLiveDeliveryAllowed(
        ruleToReadinessInput(ctx.rule, ctx.destinationFieldMapping),
        {
          duplicateRisk: ctx.duplicateRisk,
        }
      );
      readinessCanDeliverLive = true;
    } catch (err) {
      if (err instanceof LiveDeliveryNotAllowedError) {
        blockers.push(...err.assessment.blockers);
      } else {
        blockers.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (ctx.duplicateRisk?.blocksLiveDelivery) {
    blockers.push(
      ctx.duplicateRisk.recommendedAction ||
        `Duplicate risk (${ctx.duplicateRisk.riskLevel}) blocks live delivery.`
    );
  }
  if (ctx.duplicateRisk?.identityStatus === "orphan_appointment") {
    blockers.push("Orphan appointment detected; live delivery blocked.");
  }

  const adapterSimulationGate = describeAdapterSimulationGate(ctx.adapterRun);
  if (!adapterSimulationGate.passed) {
    blockers.push(
      `Recent successful GHL adapter simulation is required before live canary. ${adapterSimulationGate.detail}`
    );
  }

  if (ctx.priorSucceededRun) {
    blockers.push("A succeeded live canary run already exists for this idempotency key.");
  }

  if (ctx.duplicateRisk?.riskLevel === "possible_duplicate") {
    warnings.push("Possible duplicate — verify identity before live canary.");
  }

  return {
    canExecute: blockers.length === 0,
    blockers,
    warnings,
    adapterMode,
    idempotencyKey: ctx.idempotencyKey,
    lastAdapterSimulationRunId: ctx.adapterRun?.id ?? null,
    lastAdapterSimulationStatus: ctx.adapterRun?.status ?? null,
    lastAdapterSimulationMode: ctx.adapterRun?.mode ?? null,
    lastAdapterSimulationPassed: adapterSimulationGate.passed,
    lastAdapterSimulationDetail: adapterSimulationGate.detail,
    lastLiveRunStatus: ctx.latestLiveRun?.status ?? null,
    duplicateRiskLevel: ctx.duplicateRisk?.riskLevel ?? null,
    duplicateBlocksLive: ctx.duplicateRisk?.blocksLiveDelivery ?? false,
    readinessCanDeliverLive,
  };
}

export function validateLiveCanaryExecuteBody(input: LiveCanaryExecuteInput): string[] {
  const errors: string[] = [];
  if (input.confirmLiveDeliveryRisk !== true) {
    errors.push("confirmLiveDeliveryRisk must be true.");
  }
  if (input.operatorConfirmationText.trim() !== LIVE_CANARY_CONFIRMATION_TEXT) {
    errors.push(`operatorConfirmationText must be exactly "${LIVE_CANARY_CONFIRMATION_TEXT}".`);
  }
  return errors;
}
