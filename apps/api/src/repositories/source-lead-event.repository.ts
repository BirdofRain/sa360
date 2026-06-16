import type { Prisma, PrismaClient, SourceLeadEventStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createSourceLeadEvent(
  data: Prisma.SourceLeadEventCreateInput,
  db: PrismaClient = prisma
) {
  return db.sourceLeadEvent.create({ data });
}

export async function updateSourceLeadEvent(
  id: string,
  data: Prisma.SourceLeadEventUpdateInput,
  db: PrismaClient = prisma
) {
  return db.sourceLeadEvent.update({ where: { id }, data });
}

export async function findSourceLeadEventById(id: string, db: PrismaClient = prisma) {
  return db.sourceLeadEvent.findUnique({ where: { id } });
}

export type SourceLeadEventListFilters = {
  status?: SourceLeadEventStatus;
  sourceProvider?: string;
  sourceSystem?: string;
  matched?: boolean;
  clientAccountIdResolved?: string;
  limit?: number;
  cursor?: string;
};

export function buildSourceLeadEventWhere(
  filters: SourceLeadEventListFilters
): Prisma.SourceLeadEventWhereInput {
  const where: Prisma.SourceLeadEventWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.sourceProvider) {
    where.sourceProvider = filters.sourceProvider as Prisma.EnumSourceLeadProviderFilter["equals"];
  }
  if (filters.sourceSystem) {
    where.sourceSystem = filters.sourceSystem as Prisma.EnumSourceLeadSystemFilter["equals"];
  }
  if (filters.clientAccountIdResolved?.trim()) {
    where.clientAccountIdResolved = filters.clientAccountIdResolved.trim();
  }
  if (filters.matched === true) {
    where.status = { in: ["routing_matched", "needs_review", "approved", "delivered"] };
  } else if (filters.matched === false) {
    where.status = { in: ["routing_unmatched", "received", "normalized"] };
  }
  return where;
}

export async function findCorrelatedSourceLeadEvents(
  sourceProvider: string,
  sourceSystem: string,
  sourceLeadId: string,
  excludeEventId?: string,
  db: PrismaClient = prisma
) {
  return db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: sourceProvider as Prisma.EnumSourceLeadProviderFilter["equals"],
      sourceSystem: sourceSystem as Prisma.EnumSourceLeadSystemFilter["equals"],
      sourceLeadId,
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
    },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true,
      sourceRouteKey: true,
      receivedAt: true,
      status: true,
    },
  });
}

export async function listSourceLeadEvents(
  filters: SourceLeadEventListFilters,
  db: PrismaClient = prisma
) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where = buildSourceLeadEventWhere(filters);
  const cursor = filters.cursor ? { id: filters.cursor } : undefined;
  const items = await db.sourceLeadEvent.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return {
    items: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}
