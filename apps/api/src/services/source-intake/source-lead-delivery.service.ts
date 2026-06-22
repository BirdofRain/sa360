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

/** Recoverable status to fall back to when delivery was blocked before any external write. */
function recoverableStatusForEvent(event: SourceLeadEvent): "routing_matched" | "routing_unmatched" {
  return event.routingRuleIdResolved && event.clientAccountIdResolved
    ? "routing_matched"
    : "routing_unmatched";
}

/** Approve one source lead for simulation or live delivery via existing GHL adapter safety gates. */
export async function approveSourceLeadDelivery(
  input: ApproveSourceLeadDeliveryInput,
  deps: SourceLeadDeliveryDeps = {}
): Promise<ApproveSourceLeadDeliveryResult> {
  const findEvent = deps.findSourceLeadEventById ?? findSourceLeadEventById;
  const updateEvent = deps.updateSourceLeadEvent ?? updateSourceLeadEvent;
  const runDelivery = deps.runDirectDemoDelivery ?? runDirectDemoDelivery;
  const event = await findEvent(input.sourceLeadEventId);
  if (!event) {
    return {
      ok: false,
      error: "not_found",
      reason: "Source lead event not found.",
      sourceLeadEventId: input.sourceLeadEventId,
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

  const duplicateRisk = event.duplicateRiskJson as { blocksLiveDelivery?: boolean } | null;
  if (input.mode === "live_canary" && duplicateRisk?.blocksLiveDelivery) {
    return {
      ok: false,
      error: "duplicate_blocked",
      reason: "Duplicate risk blocks live delivery.",
      sourceLeadEventId: event.id,
    };
  }

  const now = new Date();
  await updateEvent(event.id, {
    status: "approved",
    approvedAt: now,
    approvedBy: input.approvedBy ?? null,
  });

  const deliveryResult = await runDelivery({
    payload,
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
