import type { LeadOrder, LeadOrderStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

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

export function mapLeadOrderRow(row: LeadOrder, committedAllocationCount = 0) {
  return {
    ...row,
    states: parseStatesJson(row.statesJson),
    committedAllocationCount,
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
    where.nicheKey = { equals: filters.nicheKey.trim(), mode: "insensitive" };
  }
  if (filters.cursor?.trim()) {
    where.id = { lt: filters.cursor.trim() };
  }

  const take = filters.limit + 1;
  const rows = await db.leadOrder.findMany({
    where,
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
  const row = await db.leadOrder.findUnique({ where: { id: id.trim() } });
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
  const row = await db.leadOrder.create({ data });
  return mapLeadOrderRow(row);
}

export async function updateLeadOrderRecord(
  id: string,
  data: Prisma.LeadOrderUpdateInput,
  db: PrismaClient = prisma
) {
  const row = await db.leadOrder.update({
    where: { id: id.trim() },
    data,
  });
  return mapLeadOrderRow(row);
}
