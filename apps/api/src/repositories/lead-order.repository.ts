import type { LeadOrder, LeadOrderStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";
import { prismaCommerceNicheWhere } from "../services/commerce/commerce-niche-match.js";
import { snapshotPricedPplFromOrderLines } from "../services/ppl-fulfillment/ppl-order-pricing.js";

const LEAD_ORDER_LINE_INCLUDE = {
  orderLines: { orderBy: { lineNumber: "asc" as const } },
} satisfies Prisma.LeadOrderInclude;

type LeadOrderWithOptionalLines = LeadOrder & {
  orderLines?: Array<{
    id: string;
    metadataJson: unknown;
    ageBandKeysJson: unknown;
    unitPriceCents: number | null;
    lineTotalCents: number | null;
    requestedQuantity: number;
    nicheKey: string;
    normalizedStatesJson: unknown;
  }>;
};

export type LeadOrderListFilters = {
  limit: number;
  cursor?: string;
  status?: LeadOrderStatus;
  clientAccountId?: string;
  nicheKey?: string;
};

function parseStatesJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  return [];
}

export function mapLeadOrderRow(row: LeadOrderWithOptionalLines, committedAllocationCount = 0) {
  const { orderLines, ...rest } = row;
  return {
    ...rest,
    states: parseStatesJson(row.statesJson),
    committedAllocationCount,
    pricedPpl: snapshotPricedPplFromOrderLines(orderLines),
    orderLines: orderLines ?? [],
  };
}

export async function countCommittedAllocationsByOrderIds(
  orderIds: string[],
  db: PrismaClient = prisma
): Promise<Map<string, number>> {
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const grouped = await db.leadAllocation.groupBy({
    by: ["leadOrderId"],
    where: { leadOrderId: { in: ids }, status: "committed" },
    _count: { _all: true },
  });

  return new Map(grouped.map((row) => [row.leadOrderId, row._count._all]));
}

export type CommittedOrderAllocationRow = {
  id: string;
  sourceLeadEventId: string;
  committedAt: Date | null;
};

export async function listCommittedAllocationsForOrder(
  filters: {
    leadOrderId: string;
    clientAccountId: string;
    limit: number;
    cursor?: string;
  },
  db: PrismaClient = prisma
): Promise<{ items: CommittedOrderAllocationRow[]; nextCursor: string | null }> {
  const where: Prisma.LeadAllocationWhereInput = {
    leadOrderId: filters.leadOrderId.trim(),
    clientAccountId: filters.clientAccountId.trim(),
    status: "committed",
  };
  if (filters.cursor?.trim()) {
    where.id = { lt: filters.cursor.trim() };
  }

  const take = filters.limit + 1;
  const rows = await db.leadAllocation.findMany({
    where,
    orderBy: [{ committedAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, sourceLeadEventId: true, committedAt: true },
  });

  const hasMore = rows.length > filters.limit;
  const items = hasMore ? rows.slice(0, filters.limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

export async function listLeadOrders(
  filters: LeadOrderListFilters,
  db: PrismaClient = prisma
) {
  const where: Prisma.LeadOrderWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.clientAccountId?.trim()) {
    where.clientAccountId = filters.clientAccountId.trim();
  }
  if (filters.nicheKey?.trim()) {
    Object.assign(where, prismaCommerceNicheWhere(filters.nicheKey.trim()));
  }
  if (filters.cursor?.trim()) {
    where.id = { lt: filters.cursor.trim() };
  }

  const take = filters.limit + 1;
  const rows = await db.leadOrder.findMany({
    where,
    include: LEAD_ORDER_LINE_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });

  const hasMore = rows.length > filters.limit;
  const items = hasMore ? rows.slice(0, filters.limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return {
    items: items.map((row) => mapLeadOrderRow(row)),
    nextCursor,
  };
}

export async function findLeadOrderById(id: string, db: PrismaClient = prisma) {
  const row = await db.leadOrder.findUnique({
    where: { id: id.trim() },
    include: LEAD_ORDER_LINE_INCLUDE,
  });
  return row ? mapLeadOrderRow(row) : null;
}

export async function countLeadOrdersByStatus(
  clientAccountId: string | undefined,
  db: PrismaClient = prisma
) {
  const where: Prisma.LeadOrderWhereInput = {};
  if (clientAccountId?.trim()) {
    where.clientAccountId = clientAccountId.trim();
  }

  const [submitted, needsSetup, active, paused] = await Promise.all([
    db.leadOrder.count({ where: { ...where, status: "submitted" } }),
    db.leadOrder.count({
      where: {
        ...where,
        status: { in: ["needs_setup", "needs_compliance"] },
      },
    }),
    db.leadOrder.count({ where: { ...where, status: "active" } }),
    db.leadOrder.count({ where: { ...where, status: "paused" } }),
  ]);

  return { submitted, needsSetup, active, paused };
}

export async function nextLeadOrderNumber(db: PrismaClient = prisma) {
  const count = await db.leadOrder.count();
  return `LO-${1043 + count}`;
}

export async function createLeadOrderRecord(
  data: Prisma.LeadOrderCreateInput,
  db: PrismaClient = prisma
) {
  const row = await db.leadOrder.create({
    data,
    include: LEAD_ORDER_LINE_INCLUDE,
  });
  return mapLeadOrderRow(row);
}

export type LineAllocationProgress = Record<string, { reserved: number; fulfilled: number }>;

const LINE_HELD_STATUSES = ["reserved", "delivering", "review_required"] as const;

/** Detail-path counts. Committed allocations are delivered; open holds stay reserved. */
export async function countLineAllocationProgress(
  orderId: string,
  db: PrismaClient = prisma
): Promise<LineAllocationProgress> {
  const groups = await db.leadAllocation.groupBy({
    by: ["leadOrderLineId", "status"],
    where: {
      leadOrderId: orderId,
      releasedAt: null,
      leadOrderLineId: { not: null },
      status: { in: ["reserved", "delivering", "committed", "review_required"] },
    },
    _count: { _all: true },
  });
  const progress: LineAllocationProgress = {};
  for (const group of groups) {
    if (!group.leadOrderLineId) continue;
    const bucket = progress[group.leadOrderLineId] ?? { reserved: 0, fulfilled: 0 };
    if (group.status === "committed") bucket.fulfilled += group._count._all;
    else if ((LINE_HELD_STATUSES as readonly string[]).includes(group.status)) {
      bucket.reserved += group._count._all;
    }
    progress[group.leadOrderLineId] = bucket;
  }
  return progress;
}

export async function updateLeadOrderRecord(
  id: string,
  data: Prisma.LeadOrderUpdateInput,
  db: PrismaClient = prisma
) {
  const row = await db.leadOrder.update({
    where: { id: id.trim() },
    data,
    include: LEAD_ORDER_LINE_INCLUDE,
  });
  return mapLeadOrderRow(row);
}
