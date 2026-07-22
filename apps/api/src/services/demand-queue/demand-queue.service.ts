import type { LeadOrder, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/db.js";

export type DemandQueueItem = {
  orderId: string;
  orderNumber: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  demandType: "PAY_PER_LEAD" | "RETAINER" | "UNKNOWN";
  campaignId: string | null;
  nicheKey: string;
  status: string;
  targetQuantity: number;
  delivered: number;
  remaining: number;
  reserved: number;
  proposed: number;
  dailyOrPeriodCap: number | null;
  fulfillmentCycleStart: string | null;
  fulfillmentCycleEnd: string | null;
  lastLeadReceivedAt: string | null;
  lastSuccessfulDeliveryAt: string | null;
  deliveryHealth: "healthy" | "paused" | "at_capacity" | "needs_attention";
  proofCoverageRatio: number | null;
  unmatchedErrorCount: number;
  routingRuleId: string | null;
  fulfillmentMode: string | null;
  pauseOrLiveControls: {
    orderStatus: string;
    canPause: boolean;
    canActivate: boolean;
  };
};

function demandTypeFromOrder(order: LeadOrder): DemandQueueItem["demandType"] {
  if (order.orderKind === "pay_per_lead") return "PAY_PER_LEAD";
  if (order.orderKind === "retainer_allocation") return "RETAINER";
  return "UNKNOWN";
}

function remainingForOrder(order: LeadOrder): number {
  const requested = order.requestedQuantity ?? order.leadVolume;
  return Math.max(requested - order.reservedQuantity - order.fulfilledQuantity, 0);
}

function deliveryHealth(order: LeadOrder, remaining: number): DemandQueueItem["deliveryHealth"] {
  if (order.status === "paused" || order.pausedAt) return "paused";
  if (remaining <= 0 && order.orderKind === "pay_per_lead") return "at_capacity";
  if (order.status === "active") return "healthy";
  return "needs_attention";
}

export type DemandQueueFilters = {
  clientAccountId?: string;
  /** When true, omit cross-client unmatched pool metrics (Front Office). */
  clientScoped?: boolean;
  status?: string;
  demandType?: "pay_per_lead" | "retainer_allocation";
  limit?: number;
};

export async function listDemandQueue(
  filters: DemandQueueFilters = {},
  db: PrismaClient = prisma
): Promise<{ items: DemandQueueItem[] }> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  const orders = await db.leadOrder.findMany({
    where: {
      ...(filters.clientAccountId?.trim()
        ? { clientAccountId: filters.clientAccountId.trim() }
        : {}),
      ...(filters.status?.trim() ? { status: filters.status.trim() as never } : {}),
      ...(filters.demandType ? { orderKind: filters.demandType } : { orderKind: { not: null } }),
    },
    orderBy: [{ fulfillmentPriority: "desc" }, { activatedAt: "asc" }, { createdAt: "desc" }],
    take: limit,
  });

  const items: DemandQueueItem[] = [];
  for (const order of orders) {
    const remaining = remainingForOrder(order);
    const target = order.requestedQuantity ?? order.leadVolume;

    const lastAllocation = await db.leadAllocation.findFirst({
      where: { leadOrderId: order.id },
      orderBy: { proposedAt: "desc" },
      select: {
        proposedAt: true,
        committedAt: true,
        sourceLeadEvent: { select: { receivedAt: true, deliveredAt: true } },
      },
    });

    const unmatchedErrorCount = filters.clientScoped
      ? 0
      : await db.sourceLeadEvent.count({
          where: {
            clientAccountIdResolved: order.clientAccountId,
            status: { in: ["routing_unmatched", "needs_review", "delivery_failed"] },
            cleanupStatus: null,
          },
        });

    const allocationCount = await db.leadAllocation.count({ where: { leadOrderId: order.id } });
    const proofAttachedCount = await db.leadAllocation.count({
      where: {
        leadOrderId: order.id,
        sourceLeadEvent: {
          sourceLeadUid: { not: null },
        },
      },
    });
    // Lightweight coverage proxy: allocations with a source lead uid / total allocations.
    const proofCoverageRatio =
      allocationCount === 0 ? null : Math.min(proofAttachedCount / allocationCount, 1);

    items.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      clientAccountId: order.clientAccountId,
      clientDisplayName: order.clientDisplayName,
      demandType: demandTypeFromOrder(order),
      campaignId: order.campaignId,
      nicheKey: order.nicheKey,
      status: order.status,
      targetQuantity: target,
      delivered: order.fulfilledQuantity,
      remaining,
      reserved: order.reservedQuantity,
      proposed: order.proposedQuantity,
      dailyOrPeriodCap: order.requestedQuantity,
      fulfillmentCycleStart: order.fulfillmentCycleStart?.toISOString() ?? null,
      fulfillmentCycleEnd: order.fulfillmentCycleEnd?.toISOString() ?? null,
      lastLeadReceivedAt:
        lastAllocation?.sourceLeadEvent.receivedAt.toISOString() ??
        lastAllocation?.proposedAt.toISOString() ??
        null,
      lastSuccessfulDeliveryAt:
        lastAllocation?.sourceLeadEvent.deliveredAt?.toISOString() ??
        lastAllocation?.committedAt?.toISOString() ??
        null,
      deliveryHealth: deliveryHealth(order, remaining),
      proofCoverageRatio,
      unmatchedErrorCount,
      routingRuleId: order.routingRuleId,
      fulfillmentMode: order.fulfillmentMode,
      pauseOrLiveControls: {
        orderStatus: order.status,
        canPause: order.status === "active",
        canActivate: order.status === "paused" || order.status === "ready",
      },
    });
  }

  return { items };
}
