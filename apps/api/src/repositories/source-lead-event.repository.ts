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

export async function deleteSourceLeadEventsByBulkImportId(
  bulkImportId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const result = await db.sourceLeadEvent.deleteMany({ where: { bulkImportId } });
  return result.count;
}

export async function findSourceLeadEventById(id: string, db: PrismaClient = prisma) {
  return db.sourceLeadEvent.findUnique({ where: { id } });
}

export type SourceLeadIdentityRow = {
  id: string;
  routingDryRunDecisionId: string | null;
  sourceLeadUid: string | null;
  normalizedPayloadJson: Prisma.JsonValue | null;
  receivedAt: Date;
};

/**
 * Load identity-bearing source lead rows linked to routing dry-run decisions,
 * matched either by routingDryRunDecisionId or sourceLeadUid (fallback).
 */
export async function findSourceLeadIdentitiesForDecisions(
  decisionIds: string[],
  sourceLeadUids: string[],
  db: PrismaClient = prisma
): Promise<SourceLeadIdentityRow[]> {
  const or: Prisma.SourceLeadEventWhereInput[] = [];
  if (decisionIds.length > 0) or.push({ routingDryRunDecisionId: { in: decisionIds } });
  if (sourceLeadUids.length > 0) or.push({ sourceLeadUid: { in: sourceLeadUids } });
  if (or.length === 0) return [];
  return db.sourceLeadEvent.findMany({
    where: { OR: or },
    select: {
      id: true,
      routingDryRunDecisionId: true,
      sourceLeadUid: true,
      normalizedPayloadJson: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "desc" },
  });
}

export type SourceLeadEventListFilters = {
  status?: SourceLeadEventStatus;
  sourceProvider?: string;
  sourceSystem?: string;
  matched?: boolean;
  clientAccountIdResolved?: string;
  includeCleanup?: boolean;
  cleanupStatus?: string;
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
  if (filters.cleanupStatus?.trim()) {
    where.cleanupStatus = filters.cleanupStatus.trim();
  } else if (!filters.includeCleanup) {
    where.cleanupStatus = null;
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
      bulkImportId: true,
      bulkImportRowId: true,
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
