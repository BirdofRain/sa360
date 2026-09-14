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

export async function findSourceLeadEventById(
  id: string,
  db: PrismaClient | import("@prisma/client").Prisma.TransactionClient = prisma
) {
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

/**
 * First SourceLeadEvent for a canonical source identity, oldest first.
 * Used for application-level replay (no unique index in this phase).
 */
export async function findSourceLeadEventByCanonicalIdentity(
  sourceProvider: string,
  sourceSystem: string,
  sourceLeadId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = sourceLeadId.trim();
  if (!trimmed) return null;
  return db.sourceLeadEvent.findFirst({
    where: {
      sourceProvider: sourceProvider as Prisma.EnumSourceLeadProviderFilter["equals"],
      sourceSystem: sourceSystem as Prisma.EnumSourceLeadSystemFilter["equals"],
      sourceLeadId: trimmed,
    },
    orderBy: { receivedAt: "asc" },
  });
}

/**
 * Serialize concurrent claims for the same canonical identity with a transaction
 * advisory lock, then find-or-create. Does not add a unique index.
 *
 * Remaining race: two requests can still overlap after this transaction commits and
 * before canonical processing finishes (Graph / routing). Callers must re-check
 * processed state before duplicating expensive work.
 */
export async function claimSourceLeadEventByCanonicalIdentity(
  data: Prisma.SourceLeadEventCreateInput,
  db: PrismaClient = prisma
): Promise<{ event: Awaited<ReturnType<typeof createSourceLeadEvent>>; created: boolean }> {
  const sourceLeadId =
    typeof data.sourceLeadId === "string" ? data.sourceLeadId.trim() : "";
  if (!sourceLeadId) {
    const created = await createSourceLeadEvent(data, db);
    return { event: created, created: true };
  }
  const sourceProvider = String(data.sourceProvider);
  const sourceSystem = String(data.sourceSystem);
  const lockKey = `meta-leadads:${sourceProvider}:${sourceSystem}:${sourceLeadId}`;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const existing = await findSourceLeadEventByCanonicalIdentity(
      sourceProvider,
      sourceSystem,
      sourceLeadId,
      tx
    );
    if (existing) {
      return { event: existing, created: false };
    }
    const created = await tx.sourceLeadEvent.create({ data });
    return { event: created, created: true };
  });
}

export function buildCanonicalSourceLeadLockKey(
  sourceProvider: string,
  sourceSystem: string,
  sourceLeadId: string
): string {
  return `meta-leadads:${sourceProvider}:${sourceSystem}:${sourceLeadId.trim()}`;
}

/**
 * Hold the same Postgres advisory lock used by canonical claim, for serialized
 * Graph fetch + normalize + shadow routing. Callers must not start a nested
 * claim transaction on another connection while this lock is held (deadlock).
 */
export async function withCanonicalSourceLeadLock<T>(
  sourceProvider: string,
  sourceSystem: string,
  sourceLeadId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  db: PrismaClient = prisma
): Promise<T> {
  const trimmed = sourceLeadId.trim();
  if (!trimmed) {
    throw new Error("canonical_source_lead_id_required");
  }
  const lockKey = buildCanonicalSourceLeadLockKey(sourceProvider, sourceSystem, trimmed);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      return fn(tx);
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
}

export async function findSourceLeadEventsByProviderLeadId(
  sourceLeadId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: "leadcapture_io",
      sourceLeadId: sourceLeadId.trim(),
    },
    orderBy: { receivedAt: "desc" },
  });
}

export async function findSourceLeadEventsBySourceLeadUid(
  sourceLeadUid: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.sourceLeadEvent.findMany({
    where: { sourceLeadUid: sourceLeadUid.trim() },
    orderBy: { receivedAt: "desc" },
  });
}

export async function findSourceLeadEventsByRouteKeyForIdentityPreview(
  input: {
    sourceRouteKey: string;
    clientAccountId: string;
    receivedAfter: Date;
    receivedBefore: Date;
  },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: "leadcapture_io",
      sourceRouteKey: input.sourceRouteKey.trim(),
      clientAccountIdResolved: input.clientAccountId.trim(),
      receivedAt: {
        gte: input.receivedAfter,
        lte: input.receivedBefore,
      },
    },
    orderBy: { receivedAt: "desc" },
  });
}

/**
 * Resolve LeadCapture SourceLeadEvent rows by persisted normalized event.event_uuid.
 * Uses Prisma JSON path filtering (PostgreSQL). Suitable for low-volume pilot correlation.
 */
export async function findSourceLeadEventsByExternalEventUuid(
  externalEventUuid: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = externalEventUuid.trim();
  if (!trimmed) return [];
  return db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: "leadcapture_io",
      normalizedPayloadJson: {
        path: ["event", "event_uuid"],
        equals: trimmed,
      },
    },
    orderBy: { receivedAt: "desc" },
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
