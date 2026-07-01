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

export function mapLeadOrderRow(row: LeadOrder) {
  return {
    ...row,
    states: parseStatesJson(row.statesJson),
  };
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
    items: items.map(mapLeadOrderRow),
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
