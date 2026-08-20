import type { Prisma, PrismaClient } from "@prisma/client";
import {
  CANONICAL_US_STATE_CODES,
  INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION,
  INVENTORY_STATE_REPAIR_QUARANTINE_REASON,
  isCanonicalUsStateCode,
} from "@sa360/shared";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { assertExpectedDbHost } from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import {
  classifyInvalidInventoryState,
  readSourceEventStateFields,
  type StateRepairClassification,
} from "./lead-inventory-state-repair.classify.js";

export const INVENTORY_STATE_REPAIR_MODES = ["state-repair-preview", "state-repair-commit"] as const;
export type InventoryStateRepairMode = (typeof INVENTORY_STATE_REPAIR_MODES)[number];

const REPAIR_BATCH_SIZE = 100;
const SELLABLE_STATUSES = new Set(["available"]);
const PROGRESSED_STATUSES = new Set(["reserved", "committed", "fulfilled"]);
const ACTIVE_ALLOCATION_STATUSES = new Set([
  "reserved",
  "committed",
  "delivering",
  "review_required",
]);

export type StateRepairMasterLookup = {
  bySourceLeadId: Map<string, string>;
};

export type InventoryStateRepairArgs = {
  mode: InventoryStateRepairMode;
  expectedDbHost: string;
  operator: string;
  confirmation?: string;
  authoritativeMasterLookup?: StateRepairMasterLookup;
  historicalMasterLookup?: StateRepairMasterLookup;
};

type CountMap = Record<string, number>;

function bump(map: CountMap, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

function bumpPair(map: CountMap, from: string, to: string, n = 1): void {
  bump(map, `${from} -> ${to}`, n);
}

function emptyStatusSplit() {
  return {
    available: { canonical: 0, invalid: 0 },
    reserved: { canonical: 0, invalid: 0 },
    pending_review: { canonical: 0, invalid: 0 },
    committed: { canonical: 0, invalid: 0 },
    other: { canonical: 0, invalid: 0 },
  };
}

function statusBucket(status: string): keyof ReturnType<typeof emptyStatusSplit> {
  if (status === "available") return "available";
  if (status === "reserved") return "reserved";
  if (status === "pending_review") return "pending_review";
  if (status === "committed") return "committed";
  return "other";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeStateRepairMetadata(
  existing: unknown,
  patch: Record<string, unknown>
): Prisma.InputJsonObject {
  const current = asRecord(existing) ?? {};
  return {
    ...current,
    stateRepair: {
      schema: "inventory_state_repair_v1",
      ...patch,
    },
  };
}

function lookupMasterState(
  lookup: StateRepairMasterLookup | undefined,
  sourceLeadId: string | null
): string | null {
  if (!lookup || !sourceLeadId?.trim()) return null;
  return lookup.bySourceLeadId.get(sourceLeadId.trim()) ?? null;
}

const invalidStateWhere: Prisma.LeadInventoryItemWhereInput = {
  NOT: { normalizedState: { in: [...CANONICAL_US_STATE_CODES] } },
};

type LoadedInvalidItem = {
  id: string;
  normalizedState: string;
  nicheKey: string;
  status: string;
  sourceLane: string;
  sourceProvider: string;
  inventoryLotId: string;
  metadataJson: unknown;
  inventoryLot: { lotKey: string; displayName: string };
  sourceLeadEvent: { sourceLeadId: string | null; normalizedPayloadJson: unknown };
  leadAllocations: Array<{ status: string }>;
};

function itemProgressed(item: LoadedInvalidItem, deliveredItemIds: Set<string>): boolean {
  if (PROGRESSED_STATUSES.has(item.status)) return true;
  if (deliveredItemIds.has(item.id)) return true;
  return item.leadAllocations.some((allocation) => ACTIVE_ALLOCATION_STATUSES.has(allocation.status));
}

export type InventoryStateRepairPreview = {
  ok: true;
  mode: InventoryStateRepairMode;
  readOnly: boolean;
  dbTarget: { host: string; port: string; database: string; sanitized: string };
  operator: string;
  evaluatedAt: string;
  invalidInventoryStateTotal: number;
  invalidStateValues: CountMap;
  byNiche: CountMap;
  byStatus: CountMap;
  byLot: CountMap;
  bySourceLane: CountMap;
  bySourceProvider: CountMap;
  statusSplit: ReturnType<typeof emptyStatusSplit>;
  allocatedInvalidCount: number;
  deliveredInvalidCount: number;
  progressedInvalidCount: number;
  repairableCount: number;
  unresolvedCount: number;
  conflictingCount: number;
  proposedOldToNew: CountMap;
  unresolvedStateAggregates: CountMap;
  conflictingStateAggregates: CountMap;
  sellableUnresolvedCount: number;
  sellableConflictingCount: number;
  facetRebuildRequired: boolean;
  dirtyFacetStateValues: CountMap;
  expectedCanonicalStateDistributionAfter: CountMap;
  expectedInvalidReviewCount: number;
};

function accumulatePreview(items: LoadedInvalidItem[], args: InventoryStateRepairArgs, deliveredItemIds: Set<string>) {
  const invalidStateValues: CountMap = {};
  const byNiche: CountMap = {};
  const byStatus: CountMap = {};
  const byLot: CountMap = {};
  const bySourceLane: CountMap = {};
  const bySourceProvider: CountMap = {};
  const proposedOldToNew: CountMap = {};
  const unresolvedStateAggregates: CountMap = {};
  const conflictingStateAggregates: CountMap = {};
  const expectedCanonicalAdds: CountMap = {};
  let repairableCount = 0;
  let unresolvedCount = 0;
  let conflictingCount = 0;
  let allocatedInvalidCount = 0;
  let deliveredInvalidCount = 0;
  let progressedInvalidCount = 0;
  let sellableUnresolvedCount = 0;
  let sellableConflictingCount = 0;

  const classified: Array<{
    item: LoadedInvalidItem;
    classification: StateRepairClassification;
    proposedState: string | null;
    progressed: boolean;
  }> = [];

  for (const item of items) {
    const fields = readSourceEventStateFields(item.sourceLeadEvent.normalizedPayloadJson);
    const sourceLeadId = item.sourceLeadEvent.sourceLeadId;
    const result = classifyInvalidInventoryState({
      currentNormalizedState: item.normalizedState,
      contactState: fields.contactState,
      payloadState: fields.payloadState,
      authoritativeMasterStateZip: lookupMasterState(args.authoritativeMasterLookup, sourceLeadId),
      historicalMasterStateZip: lookupMasterState(args.historicalMasterLookup, sourceLeadId),
    });
    const progressed = itemProgressed(item, deliveredItemIds);
    classified.push({
      item,
      classification: result.classification,
      proposedState: result.proposedState,
      progressed,
    });

    bump(invalidStateValues, item.normalizedState);
    bump(byNiche, item.nicheKey);
    bump(byStatus, item.status);
    bump(byLot, item.inventoryLot.lotKey);
    bump(bySourceLane, item.sourceLane);
    bump(bySourceProvider, item.sourceProvider);

    if (item.leadAllocations.length > 0) allocatedInvalidCount += 1;
    if (deliveredItemIds.has(item.id)) deliveredInvalidCount += 1;
    if (progressed) progressedInvalidCount += 1;

    if (result.classification === "REPAIRABLE_CANONICAL_STATE" && result.proposedState) {
      repairableCount += 1;
      bumpPair(proposedOldToNew, item.normalizedState, result.proposedState);
      bump(expectedCanonicalAdds, result.proposedState);
    } else if (result.classification === "CONFLICTING_STATE_EVIDENCE") {
      conflictingCount += 1;
      bump(conflictingStateAggregates, item.normalizedState);
      if (SELLABLE_STATUSES.has(item.status) && !progressed) sellableConflictingCount += 1;
    } else {
      unresolvedCount += 1;
      bump(unresolvedStateAggregates, item.normalizedState);
      if (SELLABLE_STATUSES.has(item.status) && !progressed) sellableUnresolvedCount += 1;
    }
  }

  return {
    classified,
    invalidStateValues,
    byNiche,
    byStatus,
    byLot,
    bySourceLane,
    bySourceProvider,
    proposedOldToNew,
    unresolvedStateAggregates,
    conflictingStateAggregates,
    expectedCanonicalAdds,
    repairableCount,
    unresolvedCount,
    conflictingCount,
    allocatedInvalidCount,
    deliveredInvalidCount,
    progressedInvalidCount,
    sellableUnresolvedCount,
    sellableConflictingCount,
  };
}

async function loadInvalidItems(db: PrismaClient): Promise<LoadedInvalidItem[]> {
  return db.leadInventoryItem.findMany({
    where: invalidStateWhere,
    select: {
      id: true,
      normalizedState: true,
      nicheKey: true,
      status: true,
      sourceLane: true,
      sourceProvider: true,
      inventoryLotId: true,
      metadataJson: true,
      inventoryLot: { select: { lotKey: true, displayName: true } },
      sourceLeadEvent: { select: { sourceLeadId: true, normalizedPayloadJson: true } },
      leadAllocations: { select: { status: true } },
    },
  });
}

async function loadDeliveredInvalidIds(db: PrismaClient, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await db.buyerDeliveredIdentity.findMany({
    where: { leadInventoryItemId: { in: itemIds } },
    select: { leadInventoryItemId: true },
  });
  return new Set(
    rows
      .map((row) => row.leadInventoryItemId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
}

async function loadStatusSplit(db: PrismaClient) {
  const groups = await db.leadInventoryItem.groupBy({
    by: ["normalizedState", "status"],
    _count: { _all: true },
  });
  const split = emptyStatusSplit();
  for (const row of groups) {
    const bucket = statusBucket(row.status);
    if (isCanonicalUsStateCode(row.normalizedState)) split[bucket].canonical += row._count._all;
    else split[bucket].invalid += row._count._all;
  }
  return split;
}

async function loadDirtyFacetStates(db: PrismaClient): Promise<{ dirty: CountMap; hasActiveBuild: boolean }> {
  const builds = db.leadInventoryFacetBuild;
  const aggregates = db.leadInventoryFacetSupplyAggregate;
  if (!builds?.findFirst || !aggregates?.groupBy) {
    return { dirty: {}, hasActiveBuild: false };
  }
  try {
    const active = await builds.findFirst({
      where: { status: "active" },
      select: { id: true },
      orderBy: { activatedAt: "desc" },
    });
    if (!active) return { dirty: {}, hasActiveBuild: false };
    const rows = await aggregates.groupBy({
      by: ["normalizedState"],
      where: { buildId: active.id },
      _sum: { total: true },
    });
    const dirty: CountMap = {};
    for (const row of rows) {
      if (isCanonicalUsStateCode(row.normalizedState)) continue;
      dirty[row.normalizedState] = row._sum.total ?? 0;
    }
    return { dirty, hasActiveBuild: true };
  } catch {
    try {
      const raw = await db.$queryRaw<Array<{ normalizedState: string; total: bigint | number }>>`
        SELECT a."normalizedState" AS "normalizedState", SUM(a.total)::bigint AS total
        FROM "LeadInventoryFacetSupplyAggregate" a
        INNER JOIN "LeadInventoryFacetBuild" b ON b.id = a."buildId"
        WHERE b.status = 'active'
        GROUP BY a."normalizedState"
      `;
      const dirty: CountMap = {};
      for (const row of raw) {
        if (isCanonicalUsStateCode(row.normalizedState)) continue;
        dirty[row.normalizedState] = typeof row.total === "bigint" ? Number(row.total) : row.total;
      }
      return { dirty, hasActiveBuild: true };
    } catch {
      return { dirty: {}, hasActiveBuild: false };
    }
  }
}

async function loadExpectedCanonicalDistribution(
  db: PrismaClient,
  proposedAdds: CountMap
): Promise<CountMap> {
  const groups = await db.leadInventoryItem.groupBy({
    by: ["normalizedState"],
    _count: { _all: true },
  });
  const out: CountMap = {};
  for (const row of groups) {
    if (!isCanonicalUsStateCode(row.normalizedState)) continue;
    out[row.normalizedState] = row._count._all;
  }
  for (const [state, count] of Object.entries(proposedAdds)) {
    out[state] = (out[state] ?? 0) + count;
  }
  return out;
}

async function buildPreview(
  args: InventoryStateRepairArgs,
  db: PrismaClient
): Promise<InventoryStateRepairPreview> {
  const identity = assertExpectedDbHost({
    databaseUrl: process.env.DATABASE_URL ?? "",
    expectedDbHost: args.expectedDbHost,
  });
  const items = await loadInvalidItems(db);
  const deliveredItemIds = await loadDeliveredInvalidIds(
    db,
    items.map((item) => item.id)
  );
  const acc = accumulatePreview(items, args, deliveredItemIds);
  const [statusSplit, facets, expectedCanonical] = await Promise.all([
    loadStatusSplit(db),
    loadDirtyFacetStates(db),
    loadExpectedCanonicalDistribution(db, acc.expectedCanonicalAdds),
  ]);
  const expectedInvalidReviewCount = acc.unresolvedCount + acc.conflictingCount;
  const facetRebuildRequired =
    acc.repairableCount > 0 || Object.keys(facets.dirty).length > 0 || acc.sellableUnresolvedCount > 0;

  return {
    ok: true,
    mode: args.mode,
    readOnly: args.mode === "state-repair-preview",
    dbTarget: {
      host: identity.host,
      port: identity.port,
      database: identity.database,
      sanitized: identity.sanitized,
    },
    operator: args.operator,
    evaluatedAt: new Date().toISOString(),
    invalidInventoryStateTotal: items.length,
    invalidStateValues: acc.invalidStateValues,
    byNiche: acc.byNiche,
    byStatus: acc.byStatus,
    byLot: acc.byLot,
    bySourceLane: acc.bySourceLane,
    bySourceProvider: acc.bySourceProvider,
    statusSplit,
    allocatedInvalidCount: acc.allocatedInvalidCount,
    deliveredInvalidCount: acc.deliveredInvalidCount,
    progressedInvalidCount: acc.progressedInvalidCount,
    repairableCount: acc.repairableCount,
    unresolvedCount: acc.unresolvedCount,
    conflictingCount: acc.conflictingCount,
    proposedOldToNew: acc.proposedOldToNew,
    unresolvedStateAggregates: acc.unresolvedStateAggregates,
    conflictingStateAggregates: acc.conflictingStateAggregates,
    sellableUnresolvedCount: acc.sellableUnresolvedCount,
    sellableConflictingCount: acc.sellableConflictingCount,
    facetRebuildRequired,
    dirtyFacetStateValues: facets.dirty,
    expectedCanonicalStateDistributionAfter: expectedCanonical,
    expectedInvalidReviewCount,
  };
}

export async function previewInventoryStateRepair(
  args: Omit<InventoryStateRepairArgs, "mode" | "confirmation"> & { expectedDbHost: string },
  db: PrismaClient = defaultPrisma
): Promise<InventoryStateRepairPreview> {
  return buildPreview({ ...args, mode: "state-repair-preview" }, db);
}

export async function commitInventoryStateRepair(
  args: InventoryStateRepairArgs,
  db: PrismaClient = defaultPrisma
): Promise<
  | (InventoryStateRepairPreview & {
      committed: true;
      repairedCount: number;
      quarantinedCount: number;
      metadataOnlyCount: number;
    })
  | { ok: false; error: string }
> {
  if (args.mode !== "state-repair-commit") {
    return { ok: false, error: "explicit_commit_mode_required" };
  }
  if (!args.operator.trim()) {
    return { ok: false, error: "operator_required" };
  }
  if (args.confirmation?.trim() !== INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION) {
    return { ok: false, error: "confirmation_required" };
  }

  const preview = await buildPreview(args, db);
  const items = await loadInvalidItems(db);
  const deliveredItemIds = await loadDeliveredInvalidIds(
    db,
    items.map((item) => item.id)
  );
  const acc = accumulatePreview(items, args, deliveredItemIds);
  const repairedAt = new Date().toISOString();

  let repairedCount = 0;
  let quarantinedCount = 0;
  let metadataOnlyCount = 0;

  for (let i = 0; i < acc.classified.length; i += REPAIR_BATCH_SIZE) {
    const slice = acc.classified.slice(i, i + REPAIR_BATCH_SIZE);
    await db.$transaction(async (tx) => {
      for (const row of slice) {
        if (row.classification === "REPAIRABLE_CANONICAL_STATE" && row.proposedState) {
          const updated = await tx.leadInventoryItem.updateMany({
            where: { id: row.item.id, normalizedState: row.item.normalizedState },
            data: {
              normalizedState: row.proposedState,
              metadataJson: mergeStateRepairMetadata(row.item.metadataJson, {
                classification: row.classification,
                previousState: row.item.normalizedState,
                proposedState: row.proposedState,
                operator: args.operator,
                repairedAt,
              }),
            },
          });
          repairedCount += updated.count;
          continue;
        }

        const shouldQuarantine =
          SELLABLE_STATUSES.has(row.item.status) && !row.progressed;
        if (shouldQuarantine) {
          const updated = await tx.leadInventoryItem.updateMany({
            where: { id: row.item.id, status: "available", normalizedState: row.item.normalizedState },
            data: {
              status: "quarantined",
              quarantineReason: INVENTORY_STATE_REPAIR_QUARANTINE_REASON,
              metadataJson: mergeStateRepairMetadata(row.item.metadataJson, {
                classification: row.classification,
                previousState: row.item.normalizedState,
                proposedState: null,
                operator: args.operator,
                reviewedAt: repairedAt,
                quarantineReason: INVENTORY_STATE_REPAIR_QUARANTINE_REASON,
              }),
            },
          });
          quarantinedCount += updated.count;
          continue;
        }

        const updated = await tx.leadInventoryItem.updateMany({
          where: { id: row.item.id, normalizedState: row.item.normalizedState },
          data: {
            metadataJson: mergeStateRepairMetadata(row.item.metadataJson, {
              classification: row.classification,
              previousState: row.item.normalizedState,
              proposedState: null,
              operator: args.operator,
              reviewedAt: repairedAt,
            }),
          },
        });
        metadataOnlyCount += updated.count;
      }
    });
  }

  return {
    ...preview,
    mode: "state-repair-commit",
    readOnly: false,
    committed: true,
    repairedCount,
    quarantinedCount,
    metadataOnlyCount,
  };
}

export async function runInventoryStateRepair(
  args: InventoryStateRepairArgs,
  db: PrismaClient = defaultPrisma
) {
  if (args.mode === "state-repair-preview") {
    return previewInventoryStateRepair(args, db);
  }
  return commitInventoryStateRepair(args, db);
}
