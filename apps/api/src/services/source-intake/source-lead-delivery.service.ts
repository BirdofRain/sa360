import type { SourceLeadEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { isDirectDemoDestinationAllowed } from "../../lib/direct-demo-delivery-config.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import { findSourceLeadEventById, updateSourceLeadEvent } from "../../repositories/source-lead-event.repository.js";
import {
  runDirectDemoDelivery,
  type DirectDemoDeliveryResult,
} from "../lead-delivery/direct-demo-delivery.service.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "./source-intake.types.js";
import { evaluateNextGenEventLiveCanaryForDelivery } from "./leadcapture-nextgen-canary-gate.service.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findDeliveryPlanByRoutingDecisionId } from "../../repositories/lead-delivery-plan.repository.js";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { generateDirectCanaryDeliveryPlanForDecision } from "../lead-delivery-plan.service.js";
import { isCompanySheetsInternalPilotLead } from "../company-sheets-dispatch/company-sheets-pilot-isolation.js";

export type ApproveSourceLeadDeliveryInput = {
  sourceLeadEventId: string;
  mode: "simulate" | "live_canary";
  operatorConfirmationText: string;
  confirmLiveDeliveryRisk?: boolean;
  approvedBy?: string;
};

export type ApproveSourceLeadDeliveryResult =
  | (DirectDemoDeliveryResult & { sourceLeadEventId: string })
  | {
      ok: false;
      error: string;
      reason: string;
      sourceLeadEventId: string;
    };

export type SourceLeadDeliveryDeps = {
  findSourceLeadEventById?: typeof findSourceLeadEventById;
  updateSourceLeadEvent?: typeof updateSourceLeadEvent;
  runDirectDemoDelivery?: typeof runDirectDemoDelivery;
  findDeliveryPlanByRoutingDecisionId?: typeof findDeliveryPlanByRoutingDecisionId;
  generateDirectCanaryDeliveryPlanForDecision?: typeof generateDirectCanaryDeliveryPlanForDecision;
};

const APPROVABLE_STATUSES = new Set([
  "routing_matched",
  "needs_review",
  "duplicate_blocked",
  "approved",
]);

function parseNormalizedPayload(event: SourceLeadEvent): LifecycleEventSchema | null {
  const raw = event.normalizedPayloadJson;
  if (!raw || typeof raw !== "object") return null;
  const parsed = lifecycleEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Association matches have a destination client and no campaign rule id.
 * A resolved client is still a matched route.
 */
function recoverableStatusForEvent(event: SourceLeadEvent): "routing_matched" | "routing_unmatched" {
  if (event.clientAccountIdResolved?.trim() || event.routingRuleIdResolved?.trim()) {
    return "routing_matched";
  }
  return "routing_unmatched";
}

/**
 * Point direct delivery at the lead's stored decision and plan.
 * Does not invent matchedRuleId.
 */
function withPersistedDeliveryRefs(
  payload: LifecycleEventSchema,
  decisionId: string | null,
  deliveryPlanId: string | null
): LifecycleEventSchema {
  if (!decisionId && !deliveryPlanId) return payload;
  const routing =
    payload.routing && typeof payload.routing === "object" ? { ...payload.routing } : {};
  if (decisionId) routing.routing_dry_run_decision_id = decisionId;
  if (deliveryPlanId) routing.delivery_plan_id = deliveryPlanId;
  return { ...payload, routing };
}

/** Approve one source lead for simulation or live delivery via existing GHL adapter safety gates. */
export async function approveSourceLeadDelivery(
  input: ApproveSourceLeadDeliveryInput,
  deps: SourceLeadDeliveryDeps = {}
): Promise<ApproveSourceLeadDeliveryResult> {
  const findEvent = deps.findSourceLeadEventById ?? findSourceLeadEventById;
  const updateEvent = deps.updateSourceLeadEvent ?? updateSourceLeadEvent;
  const runDelivery = deps.runDirectDemoDelivery ?? runDirectDemoDelivery;
  const findPlan =
    deps.findDeliveryPlanByRoutingDecisionId ?? findDeliveryPlanByRoutingDecisionId;
  const generatePlan =
    deps.generateDirectCanaryDeliveryPlanForDecision ??
    generateDirectCanaryDeliveryPlanForDecision;
  const event = await findEvent(input.sourceLeadEventId);
  if (!event) {
    return {
      ok: false,
      error: "not_found",
      reason: "Source lead event not found.",
      sourceLeadEventId: input.sourceLeadEventId,
    };
  }

  if (isCompanySheetsInternalPilotLead(event)) {
    return {
      ok: false,
      error: "company_sheets_internal_pilot",
      reason: "Synthetic company Sheets pilot leads are excluded from CRM delivery.",
      sourceLeadEventId: event.id,
    };
  }

  if (event.status === "delivered") {
    return {
      ok: false,
      error: "already_delivered",
      reason: "This source lead was already delivered.",
      sourceLeadEventId: event.id,
    };
  }

  if (event.status === "rejected") {
    return {
      ok: false,
      error: "rejected",
      reason: "This source lead was rejected.",
      sourceLeadEventId: event.id,
    };
  }

  if (!APPROVABLE_STATUSES.has(event.status)) {
    return {
      ok: false,
      error: "invalid_status",
      reason: `Source lead status ${event.status} is not approvable.`,
      sourceLeadEventId: event.id,
    };
  }

  if (input.operatorConfirmationText.trim() !== SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION) {
    return {
      ok: false,
      error: "confirmation_required",
      reason: `Delivery requires operatorConfirmationText: "${SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION}".`,
      sourceLeadEventId: event.id,
    };
  }

  const payload = parseNormalizedPayload(event);
  if (!payload) {
    return {
      ok: false,
      error: "invalid_payload",
      reason: "Normalized lifecycle payload missing or invalid.",
      sourceLeadEventId: event.id,
    };
  }

  const destClient = event.clientAccountIdResolved;
  const destLocation = event.destinationLocationIdResolved;
  if (!destClient || !destLocation) {
    return {
      ok: false,
      error: "routing_unmatched",
      reason: "No matched destination — create routing rule before approval.",
      sourceLeadEventId: event.id,
    };
  }

  if (!isDirectDemoDestinationAllowed(destClient, destLocation)) {
    return {
      ok: false,
      error: "destination_not_allowed",
      reason: "Matched destination is not on the direct delivery allowlist.",
      sourceLeadEventId: event.id,
    };
  }

  if (input.mode === "live_canary") {
    let deliveryMode: string | null = null;
    if (event.routingRuleIdResolved) {
      const rule = await findCampaignRoutingRuleById(event.routingRuleIdResolved);
      deliveryMode = rule?.deliveryMode ?? null;
    }
    const nextGenGate = await evaluateNextGenEventLiveCanaryForDelivery({
      sourceSystem: event.sourceSystem,
      sourceLeadEventId: event.id,
      clientAccountId: destClient,
      campaignId: event.sourceCampaignId,
      deliveryMode,
    });
    if (nextGenGate && !nextGenGate.ok) {
      return {
        ok: false,
        error: "nextgen_live_canary_blocked",
        reason: `Next-Gen live canary gate blocked delivery (${nextGenGate.reason}).`,
        sourceLeadEventId: event.id,
      };
    }
  }

  const duplicateRisk = event.duplicateRiskJson as { blocksLiveDelivery?: boolean } | null;
  if (input.mode === "live_canary" && duplicateRisk?.blocksLiveDelivery) {
    return {
      ok: false,
      error: "duplicate_blocked",
      reason: "Duplicate risk blocks live delivery.",
      sourceLeadEventId: event.id,
    };
  }

  const decisionId = event.routingDryRunDecisionId?.trim() || null;
  let deliveryPlanId: string | null = null;
  if (decisionId) {
    const existingPlan = await findPlan(decisionId);
    if (existingPlan) {
      deliveryPlanId = existingPlan.id;
    } else {
      const created = await generatePlan(decisionId, {
        attribution: extractRoutingAttributionFromPayload(payload),
      });
      if ("blocked" in created) {
        return {
          ok: false,
          error: created.blocked,
          reason: "Synthetic company Sheets pilot leads are excluded from CRM delivery.",
          sourceLeadEventId: event.id,
        };
      }
      if ("notFound" in created) {
        return {
          ok: false,
          error: "routing_decision_not_found",
          reason: "Stored routing decision was not found, so no delivery plan was created.",
          sourceLeadEventId: event.id,
        };
      }
      deliveryPlanId = created.plan.id;
    }
  }

  const now = new Date();
  await updateEvent(event.id, {
    status: "approved",
    approvedAt: now,
    approvedBy: input.approvedBy ?? null,
  });

  const deliveryResult = await runDelivery({
    payload: withPersistedDeliveryRefs(payload, decisionId, deliveryPlanId),
    mode: input.mode,
    confirmLiveDeliveryRisk: input.mode === "live_canary" ? true : false,
    operatorConfirmationText:
      input.mode === "live_canary" ? LIVE_CANARY_CONFIRMATION_TEXT : "",
  });

  const deliveryJson = deliveryResult as object;
  if (deliveryResult.ok && input.mode === "live_canary" && deliveryResult.externalCallExecuted) {
    await updateEvent(event.id, {
      status: "delivered",
      deliveredAt: new Date(),
      deliveryResultJson: deliveryJson,
    });
  } else if (deliveryResult.ok && input.mode === "simulate") {
    await updateEvent(event.id, {
      deliveryResultJson: deliveryJson,
    });
  } else if (!deliveryResult.ok) {
    const externalWriteAttempted = deliveryResult.externalCallExecuted === true;
    if (externalWriteAttempted) {
      // A real external GHL write was attempted and failed → terminal failure
      // that requires an explicit requeue before another attempt.
      await updateEvent(event.id, {
        status: "delivery_failed",
        deliveryResultJson: deliveryJson,
        errorSummary: deliveryResult.reason,
      });
    } else {
      // Blocked before any external GHL write (runtime mode mismatch, preflight,
      // duplicate/plan block). Keep the lead recoverable/approvable instead of
      // stranding it in delivery_failed; deliveryResultJson explains the block.
      await updateEvent(event.id, {
        status: recoverableStatusForEvent(event),
        approvedAt: null,
        approvedBy: null,
        deliveryResultJson: deliveryJson,
        errorSummary: deliveryResult.reason,
      });
    }
  }

  return { ...deliveryResult, sourceLeadEventId: event.id };
}

export async function rejectSourceLeadEvent(
  id: string,
  approvedBy?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const event = await findSourceLeadEventById(id);
  if (!event) return { ok: false, error: "not_found" };
  if (event.status === "delivered") return { ok: false, error: "already_delivered" };
  await updateSourceLeadEvent(id, {
    status: "rejected",
    approvedBy: approvedBy ?? null,
    approvedAt: new Date(),
  });
  return { ok: true };
}

export async function requeueSourceLeadEvent(
  id: string,
  deps: SourceLeadDeliveryDeps = {}
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const findEvent = deps.findSourceLeadEventById ?? findSourceLeadEventById;
  const updateEvent = deps.updateSourceLeadEvent ?? updateSourceLeadEvent;
  const event = await findEvent(id);
  if (!event) return { ok: false, error: "not_found" };
  if (isCompanySheetsInternalPilotLead(event)) return { ok: false, error: "company_sheets_internal_pilot" };
  // Delivered or rejected leads are terminal and must not be requeued.
  if (event.status === "delivered") return { ok: false, error: "already_delivered" };
  if (event.status === "rejected") return { ok: false, error: "already_rejected" };

  const nextStatus = recoverableStatusForEvent(event);

  await updateEvent(id, {
    status: nextStatus,
    approvedAt: null,
    approvedBy: null,
    deliveryResultJson: Prisma.DbNull,
    errorSummary: null,
  });
  return { ok: true, status: nextStatus };
}
