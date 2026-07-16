import type { LeadInventoryItemStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import { assessLeadInventoryActivationEligibility } from "./lead-inventory-review-eligibility.service.js";
import { presentSafeEligibilitySnapshot } from "./lead-inventory-review-sanitize.js";
import { loadReviewItemsWithEligibility } from "./lead-inventory-review-load.js";

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

export async function buildLeadInventoryReviewSummary(db: PrismaClient = defaultPrisma) {
  const evaluatedAt = new Date();
  const statusGroups = await db.leadInventoryItem.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(
    statusGroups.map((row) => [row.status, row._count._all])
  ) as Record<string, number>;

  const pendingItems = await db.leadInventoryItem.findMany({
    where: { status: "pending_review" },
    select: { id: true },
    take: 500,
  });
  const pendingIds = pendingItems.map((item) => item.id);
  let eligibleNow = 0;
  let blocked = 0;
  if (pendingIds.length > 0) {
    const loaded = await loadReviewItemsWithEligibility(pendingIds, db, evaluatedAt);
    for (const row of loaded.results) {
      if (row.eligibility?.eligible) eligibleNow += 1;
      else blocked += 1;
    }
  }

  const byState = await db.leadInventoryItem.groupBy({
    by: ["normalizedState", "status"],
    _count: { _all: true },
  });
  const bySourceLane = await db.leadInventoryItem.groupBy({
    by: ["sourceLane", "status"],
    _count: { _all: true },
  });

  const batches = await db.leadInventoryImportBatch.findMany({
    where: { status: "committed" },
    orderBy: { committedAt: "desc" },
    take: 50,
  });

  const batchSummaries = [];
  for (const batch of batches) {
    const lotId = batch.inventoryLotId;
    const items = lotId
      ? await db.leadInventoryItem.findMany({
          where: { inventoryLotId: lotId },
          select: { id: true, status: true },
        })
      : await db.leadInventoryItem.findMany({
          where: {
            metadataJson: {
              path: ["importRequestId"],
              equals: batch.requestId,
            },
          },
          select: { id: true, status: true },
        });

    const counts = {
      imported: items.length,
      pending: 0,
      available: 0,
      quarantined: 0,
      rejected: 0,
      eligible: 0,
      blocked: 0,
    };
    for (const item of items) {
      if (item.status === "pending_review") counts.pending += 1;
      if (item.status === "available") counts.available += 1;
      if (item.status === "quarantined") counts.quarantined += 1;
      if (item.status === "rejected") counts.rejected += 1;
    }
    const pendingBatchIds = items
      .filter((item) => item.status === "pending_review")
      .map((item) => item.id);
    if (pendingBatchIds.length > 0) {
      const loaded = await loadReviewItemsWithEligibility(pendingBatchIds, db, evaluatedAt);
      for (const row of loaded.results) {
        if (row.eligibility?.eligible) counts.eligible += 1;
        else counts.blocked += 1;
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
      pendingReview: byStatus.pending_review ?? 0,
      eligibleNow,
      blocked,
      available: byStatus.available ?? 0,
      quarantined: byStatus.quarantined ?? 0,
      rejected: byStatus.rejected ?? 0,
    },
    byStatus,
    byState: byState.map((row) => ({
      normalizedState: row.normalizedState,
      status: row.status,
      count: row._count._all,
    })),
    bySourceLane: bySourceLane.map((row) => ({
      sourceLane: row.sourceLane,
      status: row.status,
      count: row._count._all,
    })),
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
