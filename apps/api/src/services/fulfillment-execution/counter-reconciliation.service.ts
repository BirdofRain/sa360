import type { LeadAllocationStatus, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";

const RESERVED_STATUSES: LeadAllocationStatus[] = ["reserved", "delivering", "review_required"];
const FULFILLED_STATUS: LeadAllocationStatus = "committed";

export type OrderCounterReconciliation = {
  leadOrderId: string;
  storedReservedQuantity: number;
  storedFulfilledQuantity: number;
  expectedReservedCount: number;
  expectedFulfilledCount: number;
  reservedDrift: number;
  fulfilledDrift: number;
  inSync: boolean;
};

export async function reconcileLeadOrderCounters(
  leadOrderId: string,
  db: PrismaClient = prisma
): Promise<OrderCounterReconciliation | null> {
  const order = await db.leadOrder.findUnique({ where: { id: leadOrderId.trim() } });
  if (!order) return null;

  const grouped = await db.leadAllocation.groupBy({
    by: ["status"],
    where: { leadOrderId: order.id },
    _count: { _all: true },
  });

  let expectedReservedCount = 0;
  let expectedFulfilledCount = 0;
  for (const row of grouped) {
    if (RESERVED_STATUSES.includes(row.status)) {
      expectedReservedCount += row._count._all;
    }
    if (row.status === FULFILLED_STATUS) {
      expectedFulfilledCount += row._count._all;
    }
  }

  const reservedDrift = order.reservedQuantity - expectedReservedCount;
  const fulfilledDrift = order.fulfilledQuantity - expectedFulfilledCount;

  return {
    leadOrderId: order.id,
    storedReservedQuantity: order.reservedQuantity,
    storedFulfilledQuantity: order.fulfilledQuantity,
    expectedReservedCount,
    expectedFulfilledCount,
    reservedDrift,
    fulfilledDrift,
    inSync: reservedDrift === 0 && fulfilledDrift === 0,
  };
}
