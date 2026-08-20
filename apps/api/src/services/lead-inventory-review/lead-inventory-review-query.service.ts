import type { LeadInventoryItemStatus, Prisma, PrismaClient } from "@prisma/client";
import { isCanonicalUsStateCode } from "@sa360/shared";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { isLeadInventoryReviewEnabled } from "../../lib/lead-inventory-review-env.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import { presentSafeEligibilitySnapshot } from "./lead-inventory-review-sanitize.js";
import { loadReviewItemsWithEligibility } from "./lead-inventory-review-load.js";

/** Max pending-review IDs evaluated for eligibility on summary (global and per-batch). */
export const REVIEW_SUMMARY_PENDING_ID_LIMIT = 500;
/** Max committed import batches returned on the summary. */
export const REVIEW_SUMMARY_BATCH_LIMIT = 50;

export type ReviewSummaryDetail = "bootstrap" | "full";

export type ReviewItemsQuery = {
  status?: string;
  importBatchRequestId?: string;
  inventoryLotId?: string;
  normalizedState?: string;
  ageBandKey?: string;
  nicheKey?: string;
  productType?: string;
  sourceLane?: string;
  blockerCode?: string;
  generatedFrom?: string;
  generatedTo?: string;
  cursor?: string;
  limit?: number;
};

export type BuildLeadInventoryReviewSummaryOpts = {
  signal?: AbortSignal;
  /**
   * `bootstrap` — lightweight overview for Fulfillment Ops (skips unused full-table breakdowns).
   * `full` — detailed Review Queue / API summary (default).
   */
  detail?: ReviewSummaryDetail;
  /** Test seam — defaults to production eligibility loader. */
  eligibilityLoader?: typeof loadReviewItemsWithEligibility;
};

type StatusCountRow = { status: LeadInventoryItemStatus | string; _count: { _all: number } };

type BatchStatusCounts = {
  imported: number;
  pending: number;
  available: number;
  quarantined: number;
  rejected: number;
};

function emptyBatchStatusCounts(): BatchStatusCounts {
  return {
    imported: 0,
    pending: 0,
    available: 0,
    quarantined: 0,
    rejected: 0,
  };
}

function applyStatusCountRows(rows: StatusCountRow[], into: BatchStatusCounts): void {
  for (const row of rows) {
    const n = row._count._all;
    into.imported += n;
    if (row.status === "pending_review") into.pending += n;
    else if (row.status === "available") into.available += n;
    else if (row.status === "quarantined") into.quarantined += n;
    else if (row.status === "rejected") into.rejected += n;
  }
}

/**
 * Aggregate inventory status counts for displayed committed batches.
 * Prefer one groupBy across lot IDs; fall back to per-batch status groupBy for metadata-only batches.
 * Does not retrieve inventory row payloads into Node.
 */
export async function aggregateCommittedBatchStatusCounts(
  db: PrismaClient,
  batches: Array<{ requestId: string; inventoryLotId: string | null }>,
  opts?: { signal?: AbortSignal }
): Promise<Map<string, BatchStatusCounts>> {
  const signal = opts?.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error("inventory_review_summary_aborted");
      err.name = "AbortError";
      throw err;
    }
  };

  const byRequestId = new Map<string, BatchStatusCounts>();
  for (const batch of batches) {
    byRequestId.set(batch.requestId, emptyBatchStatusCounts());
  }

  const lotIds = [
    ...new Set(batches.map((b) => b.inventoryLotId).filter((id): id is string => Boolean(id))),
  ];
  const lotIdToRequestIds = new Map<string, string[]>();
  for (const batch of batches) {
    if (!batch.inventoryLotId) continue;
    const list = lotIdToRequestIds.get(batch.inventoryLotId) ?? [];
    list.push(batch.requestId);
    lotIdToRequestIds.set(batch.inventoryLotId, list);
  }

  throwIfAborted();
  if (lotIds.length > 0) {
    const lotGroups = await db.leadInventoryItem.groupBy({
      by: ["inventoryLotId", "status"],
      where: { inventoryLotId: { in: lotIds } },
      _count: { _all: true },
    });
    for (const row of lotGroups) {
      const requestIds = lotIdToRequestIds.get(row.inventoryLotId) ?? [];
      for (const requestId of requestIds) {
        const counts = byRequestId.get(requestId);
        if (!counts) continue;
        applyStatusCountRows([row], counts);
      }
    }
  }

  const metadataBatches = batches.filter((b) => !b.inventoryLotId);
  for (const batch of metadataBatches) {
    throwIfAborted();
    const statusGroups = await db.leadInventoryItem.groupBy({
      by: ["status"],
      where: {
        metadataJson: {
          path: ["importRequestId"],
          equals: batch.requestId,
        },
      },
      _count: { _all: true },
    });
    const counts = byRequestId.get(batch.requestId) ?? emptyBatchStatusCounts();
    applyStatusCountRows(statusGroups, counts);
    byRequestId.set(batch.requestId, counts);
  }

  return byRequestId;
}

export async function buildLeadInventoryReviewSummary(
  db: PrismaClient = defaultPrisma,
  opts?: BuildLeadInventoryReviewSummaryOpts
) {
  const evaluatedAt = new Date();
  const signal = opts?.signal;
  const detail: ReviewSummaryDetail = opts?.detail ?? "full";
  const eligibilityLoader = opts?.eligibilityLoader ?? loadReviewItemsWithEligibility;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error("inventory_review_summary_aborted");
      err.name = "AbortError";
      throw err;
    }
  };

  throwIfAborted();

  // When review/activation is disabled, skip eligibility fan-out and batch scans.
  if (!isLeadInventoryReviewEnabled()) {
    const statusGroups = await db.leadInventoryItem.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all])
    ) as Record<string, number>;
    return {
      evaluatedAt: evaluatedAt.toISOString(),
      counts: {
        pendingReview: byStatus.pending_review ?? 0,
        eligibleNow: 0,
        blocked: 0,
        available: byStatus.available ?? 0,
        quarantined: byStatus.quarantined ?? 0,
        rejected: byStatus.rejected ?? 0,
      },
      byStatus,
      byState: [] as Array<{ normalizedState: string; status: string; count: number }>,
      bySourceLane: [] as Array<{ sourceLane: string; status: string; count: number }>,
      batches: [] as Array<Record<string, unknown>>,
      featureSkipped: true as const,
    };
  }

  throwIfAborted();
  const statusGroups = await db.leadInventoryItem.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(
    statusGroups.map((row) => [row.status, row._count._all])
  ) as Record<string, number>;

  const pendingReviewCount = byStatus.pending_review ?? 0;

  throwIfAborted();
  const pendingItems =
    pendingReviewCount > 0
      ? await db.leadInventoryItem.findMany({
          where: { status: "pending_review" },
          select: { id: true },
          take: REVIEW_SUMMARY_PENDING_ID_LIMIT,
          orderBy: { id: "asc" },
        })
      : [];
  const pendingIds = pendingItems.map((item) => item.id);
  let eligibleNow = 0;
  let blocked = 0;
  if (pendingIds.length > 0) {
    throwIfAborted();
    const loaded = await eligibilityLoader(pendingIds, db, evaluatedAt);
    for (const row of loaded.results) {
      if (row.eligibility?.eligible) eligibleNow += 1;
      else blocked += 1;
    }
  }

  // Full-table state/sourceLane breakdowns are unused by Fulfillment Ops bootstrap and the
  // Review Queue UI; keep them for the dedicated summary API (`detail: "full"`).
  let byState: Array<{ normalizedState: string; status: string; count: number }> = [];
  let bySourceLane: Array<{ sourceLane: string; status: string; count: number }> = [];
  if (detail === "full") {
    throwIfAborted();
    const [stateGroups, sourceLaneGroups] = await Promise.all([
      db.leadInventoryItem.groupBy({
        by: ["normalizedState", "status"],
        _count: { _all: true },
      }),
      db.leadInventoryItem.groupBy({
        by: ["sourceLane", "status"],
        _count: { _all: true },
      }),
    ]);
    byState = stateGroups
      .filter((row) => isCanonicalUsStateCode(row.normalizedState))
      .map((row) => ({
        normalizedState: row.normalizedState,
        status: row.status,
        count: row._count._all,
      }));
    bySourceLane = sourceLaneGroups.map((row) => ({
      sourceLane: row.sourceLane,
      status: row.status,
      count: row._count._all,
    }));
  }

  throwIfAborted();
  const batches = await db.leadInventoryImportBatch.findMany({
    where: { status: "committed" },
    orderBy: { committedAt: "desc" },
    take: REVIEW_SUMMARY_BATCH_LIMIT,
  });

  const statusByRequestId = await aggregateCommittedBatchStatusCounts(db, batches, { signal });

  const batchSummaries = [];
  for (const batch of batches) {
    throwIfAborted();
    const counts = {
      ...emptyBatchStatusCounts(),
      ...(statusByRequestId.get(batch.requestId) ?? emptyBatchStatusCounts()),
      eligible: 0,
      blocked: 0,
    };

    // Batch eligible/blocked only when this batch has pending_review rows.
    if (counts.pending > 0) {
      throwIfAborted();
      const pendingBatchItems = batch.inventoryLotId
        ? await db.leadInventoryItem.findMany({
            where: { inventoryLotId: batch.inventoryLotId, status: "pending_review" },
            select: { id: true },
            take: REVIEW_SUMMARY_PENDING_ID_LIMIT,
            orderBy: { id: "asc" },
          })
        : await db.leadInventoryItem.findMany({
            where: {
              status: "pending_review",
              metadataJson: {
                path: ["importRequestId"],
                equals: batch.requestId,
              },
            },
            select: { id: true },
            take: REVIEW_SUMMARY_PENDING_ID_LIMIT,
            orderBy: { id: "asc" },
          });
      if (pendingBatchItems.length > 0) {
        const loaded = await eligibilityLoader(
          pendingBatchItems.map((item) => item.id),
          db,
          evaluatedAt
        );
        for (const row of loaded.results) {
          if (row.eligibility?.eligible) counts.eligible += 1;
          else counts.blocked += 1;
        }
      }
    }

    batchSummaries.push({
      requestId: batch.requestId,
      lotKey: batch.lotKey,
      sourceLane: batch.sourceLane,
      inventoryLotId: batch.inventoryLotId,
      createdAt: batch.createdAt.toISOString(),
      committedAt: batch.committedAt?.toISOString() ?? null,
      ...counts,
    });
  }

  return {
    evaluatedAt: evaluatedAt.toISOString(),
    counts: {
      pendingReview: pendingReviewCount,
      eligibleNow,
      blocked,
      available: byStatus.available ?? 0,
      quarantined: byStatus.quarantined ?? 0,
      rejected: byStatus.rejected ?? 0,
    },
    byStatus,
    byState,
    bySourceLane,
    batches: batchSummaries,
  };
}

export async function buildLeadInventoryReviewItemsList(
  query: ReviewItemsQuery,
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = new Date();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const status = (query.status?.trim() || "pending_review") as LeadInventoryItemStatus;

  const where: Prisma.LeadInventoryItemWhereInput = {
    status,
  };
  if (query.inventoryLotId) where.inventoryLotId = query.inventoryLotId;
  if (query.normalizedState) where.normalizedState = query.normalizedState.trim().toUpperCase();
  if (query.nicheKey) where.nicheKey = query.nicheKey;
  if (query.productType) where.productType = query.productType;
  if (query.sourceLane) where.sourceLane = query.sourceLane;
  if (query.importBatchRequestId) {
    where.metadataJson = {
      path: ["importRequestId"],
      equals: query.importBatchRequestId,
    };
  }
  if (query.generatedFrom || query.generatedTo) {
    where.generatedAt = {};
    if (query.generatedFrom) where.generatedAt.gte = new Date(query.generatedFrom);
    if (query.generatedTo) where.generatedAt.lte = new Date(query.generatedTo);
  }
  if (query.cursor) {
    where.id = { gt: query.cursor };
  }

  const rows = await db.leadInventoryItem.findMany({
    where,
    orderBy: { id: "asc" },
    take: limit,
    include: {
      inventoryLot: { select: { id: true, lotKey: true, displayName: true } },
    },
  });

  const loaded = await loadReviewItemsWithEligibility(
    rows.map((row) => row.id),
    db,
    evaluatedAt
  );
  const eligibilityById = new Map(
    loaded.results.filter((row) => row.found).map((row) => [row.itemId, row.eligibility])
  );

  const ageBands = await listActiveAgeBandDefinitions(undefined, db);
  const items = [];

  for (const row of rows) {
    const eligibility = eligibilityById.get(row.id);
    if (query.blockerCode && eligibility && !eligibility.blockerCodes.includes(query.blockerCode as never)) {
      continue;
    }
    if (query.ageBandKey) {
      const ageDays = calculateInventoryAgeDays(row.generatedAt, evaluatedAt);
      const band = resolveAgeBandKey(ageDays, ageBands);
      if (band !== query.ageBandKey) continue;
    }

    items.push({
      inventoryItemId: row.id,
      maskedInventoryReference: maskSourceLeadUidForAudit(row.id) ?? "inv***",
      inventoryLotId: row.inventoryLotId,
      lotKey: row.inventoryLot.lotKey,
      lotDisplayName: row.inventoryLot.displayName,
      normalizedState: row.normalizedState,
      generatedAt: row.generatedAt.toISOString(),
      ageDays: eligibility?.ageDays ?? null,
      ageBandKey: eligibility?.ageBandKey ?? null,
      nicheKey: row.nicheKey,
      productType: row.productType,
      sourceLane: row.sourceLane,
      duplicateStatus: eligibility?.duplicateStatus ?? "UNCHECKED",
      provenanceStatus: eligibility?.provenance.hasImportRequestId ? "present" : "missing",
      eligible: eligibility?.eligible ?? false,
      blockerCount: eligibility?.blockerCodes.length ?? 0,
      blockerCodes: eligibility?.blockerCodes ?? [],
      status: row.status,
    });
  }

  return {
    items,
    nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

export async function buildLeadInventoryReviewItemDetail(
  itemId: string,
  db: PrismaClient = defaultPrisma
) {
  const loaded = await loadReviewItemsWithEligibility([itemId], db);
  const row = loaded.results[0];
  if (!row?.found || !row.item || !row.eligibility) return null;

  const history = await db.leadInventoryReviewItemResult.findMany({
    where: { leadInventoryItemId: itemId },
    orderBy: { createdAt: "desc" },
    include: {
      reviewAction: {
        select: {
          requestId: true,
          actionType: true,
          actionStatus: true,
          reasonCode: true,
          committedAt: true,
          createdAt: true,
        },
      },
    },
  });

  const importRequestId =
    row.item.metadataJson &&
    typeof row.item.metadataJson === "object" &&
    !Array.isArray(row.item.metadataJson) &&
    typeof (row.item.metadataJson as Record<string, unknown>).importRequestId === "string"
      ? String((row.item.metadataJson as Record<string, unknown>).importRequestId)
      : null;

  return {
    inventoryItemId: row.item.id,
    maskedInventoryReference: maskSourceLeadUidForAudit(row.item.id) ?? "inv***",
    status: row.item.status,
    normalizedState: row.item.normalizedState,
    generatedAt: row.item.generatedAt.toISOString(),
    nicheKey: row.item.nicheKey,
    productType: row.item.productType,
    sourceLane: row.item.sourceLane,
    sourceProvider: row.item.sourceProvider,
    inventoryLotId: row.item.inventoryLotId,
    lotKey: row.item.inventoryLot?.lotKey ?? null,
    importRequestId,
    availableAt: row.item.availableAt?.toISOString() ?? null,
    rejectedAt: row.item.rejectedAt?.toISOString() ?? null,
    quarantineReason: row.item.quarantineReason,
    eligibility: presentSafeEligibilitySnapshot(row.eligibility),
    reviewHistory: history.map((entry) => ({
      requestId: entry.reviewAction.requestId,
      actionType: entry.reviewAction.actionType,
      actionStatus: entry.reviewAction.actionStatus,
      reasonCode: entry.reasonCode ?? entry.reviewAction.reasonCode,
      priorStatus: entry.priorStatus,
      resultingStatus: entry.resultingStatus,
      blockerCodes: entry.blockerCodesJson,
      appliedAt: entry.appliedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}
