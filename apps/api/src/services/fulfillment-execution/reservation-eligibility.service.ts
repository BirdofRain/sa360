import type { LeadAllocation, LeadOrder, PrismaClient } from "@prisma/client";
import {
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
  FULFILLMENT_SUPPORTED_FULFILLMENT_MODES,
  FULFILLMENT_SUPPORTED_ORDER_KINDS,
} from "@sa360/shared";

import { findLeadEligibilityAssessment } from "../../repositories/lead-eligibility.repository.js";
import { prisma } from "../../lib/db.js";
import type { ReservationFailureCode } from "./fulfillment-execution.types.js";
import { ACTIVE_EXCLUSIVE_ALLOCATION_STATUSES } from "./fulfillment-execution.types.js";

type AllocationWithRelations = LeadAllocation & {
  leadOrder: LeadOrder;
  deliveryInstructions: Array<{ id: string; isRequired: boolean; status: string }>;
};

function withinFulfillmentCycle(order: LeadOrder, at: Date): boolean {
  if (!order.fulfillmentCycleStart && !order.fulfillmentCycleEnd) return true;
  if (order.fulfillmentCycleStart && at < order.fulfillmentCycleStart) return false;
  if (order.fulfillmentCycleEnd && at > order.fulfillmentCycleEnd) return false;
  return true;
}

function isSupportedOrderKind(value: string | null | undefined): boolean {
  if (!value) return false;
  return (FULFILLMENT_SUPPORTED_ORDER_KINDS as readonly string[]).includes(value);
}

function isSupportedFulfillmentMode(value: string | null | undefined): boolean {
  if (!value) return false;
  return (FULFILLMENT_SUPPORTED_FULFILLMENT_MODES as readonly string[]).includes(value);
}

export async function validateReservationEligibility(
  allocation: AllocationWithRelations,
  db: PrismaClient = prisma,
  at = new Date()
): Promise<{ ok: true } | { ok: false; code: ReservationFailureCode; reasons: string[] }> {
  const reasons: string[] = [];

  if (allocation.status !== "shadow") {
    return {
      ok: false,
      code: "invalid_allocation_status",
      reasons: [`allocation_status_${allocation.status}`],
    };
  }

  if (allocation.clientAccountId !== allocation.leadOrder.clientAccountId) {
    return { ok: false, code: "tenant_mismatch", reasons: ["allocation_order_client_mismatch"] };
  }

  const order = allocation.leadOrder;
  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    return { ok: false, code: "order_not_active", reasons: [`order_status_${order.status}`] };
  }

  if (!isSupportedOrderKind(order.orderKind)) {
    return { ok: false, code: "unsupported_order_kind", reasons: ["order_kind_not_supported"] };
  }

  if (!isSupportedFulfillmentMode(order.fulfillmentMode)) {
    return {
      ok: false,
      code: "unsupported_fulfillment_mode",
      reasons: ["fulfillment_mode_not_supported"],
    };
  }

  if (order.requestedQuantity == null || order.requestedQuantity <= 0) {
    return { ok: false, code: "order_not_configured", reasons: ["requested_quantity_not_configured"] };
  }

  if (!withinFulfillmentCycle(order, at)) {
    return { ok: false, code: "outside_fulfillment_cycle", reasons: ["outside_fulfillment_cycle"] };
  }

  const eligibility = await findLeadEligibilityAssessment(
    {
      sourceLeadEventId: allocation.sourceLeadEventId,
      policyKey: FULFILLMENT_ELIGIBILITY_POLICY_KEY,
      policyVersion: FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
    },
    db
  );
  if (!eligibility || eligibility.status !== "eligible") {
    return { ok: false, code: "ineligible_assessment", reasons: ["eligibility_not_eligible"] };
  }

  const requiredInstructions = allocation.deliveryInstructions.filter((row) => row.isRequired);
  if (requiredInstructions.length === 0) {
    return {
      ok: false,
      code: "missing_required_instruction",
      reasons: ["no_required_delivery_instruction"],
    };
  }

  const conflicting = await db.leadAllocation.findFirst({
    where: {
      sourceLeadEventId: allocation.sourceLeadEventId,
      status: { in: ACTIVE_EXCLUSIVE_ALLOCATION_STATUSES },
      NOT: { id: allocation.id },
    },
    select: { id: true, status: true },
  });
  if (conflicting) {
    return {
      ok: false,
      code: "exclusive_source_conflict",
      reasons: [`exclusive_source_conflict:${conflicting.status}`],
    };
  }

  const consumed = order.reservedQuantity + order.fulfilledQuantity;
  if (consumed >= order.requestedQuantity) {
    return { ok: false, code: "capacity_exhausted", reasons: ["order_capacity_exhausted"] };
  }

  if (reasons.length > 0) {
    return { ok: false, code: "order_not_configured", reasons };
  }

  return { ok: true };
}

export async function loadAllocationForReservation(
  allocationId: string,
  db: PrismaClient = prisma
): Promise<AllocationWithRelations | null> {
  return db.leadAllocation.findUnique({
    where: { id: allocationId.trim() },
    include: {
      leadOrder: true,
      deliveryInstructions: {
        select: { id: true, isRequired: true, status: true },
        orderBy: { sequence: "asc" },
      },
    },
  }) as Promise<AllocationWithRelations | null>;
}
