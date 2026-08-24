import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import {
  countInventoryItemsByStatus,
  countInventoryLotsByStatus,
  listActiveAgeBandDefinitions,
} from "../../repositories/lead-inventory.repository.js";
import { evaluateLeadInventoryAvailability } from "./lead-inventory-availability.service.js";

/** Hard cap — never load/evaluate the full inventory table for summary counts. */
export const LEAD_INVENTORY_SUMMARY_MAX_ITEMS = 1000;
const SUMMARY_CHUNK_SIZE = 100;

const inventorySummarySelect = {
  id: true,
  status: true,
  generatedAt: true,
  normalizedState: true,
  inventoryClass: true,
  nicheKey: true,
  maxFulfillments: true,
  fulfillmentCount: true,
  quarantineReason: true,
  withdrawnAt: true,
  expiredAt: true,
  commerceExcludedAt: true,
  sourceLeadEvent: {
    select: {
      sourceProvider: true,
      sourceSystem: true,
      sourceLeadUid: true,
      normalizedPayloadJson: true,
      enrichmentMetadataJson: true,
    },
  },
  inventoryLot: { select: { status: true } },
  leadAllocations: { select: { status: true, leadInventoryItemId: true } },
} as const;

export type LeadInventorySummary = {
  totalItems: number;
  available: number;
  reserved: number;
  committed: number;
  fulfilled: number;
  quarantined: number;
  expired: number;
  lotsActive: number;
  lotsPaused: number;
  proofReady: number;
  verificationReady: number;
  evaluatedAt: string;
  scannedItems: number;
  truncated: boolean;
};

export async function buildLeadInventorySummary(
  db: PrismaClient = defaultPrisma,
  opts?: { signal?: AbortSignal; maxItems?: number }
): Promise<LeadInventorySummary> {
  const evaluatedAt = new Date();
  const maxItems = Math.max(1, Math.min(opts?.maxItems ?? LEAD_INVENTORY_SUMMARY_MAX_ITEMS, 5000));
  const signal = opts?.signal;

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error("inventory_summary_aborted");
      err.name = "AbortError";
      throw err;
    }
  };

  throwIfAborted();

  const [itemCounts, lotCounts, ageBands, totalItems] = await Promise.all([
    countInventoryItemsByStatus(db),
    countInventoryLotsByStatus(db),
    listActiveAgeBandDefinitions(undefined, db),
    db.leadInventoryItem.count(),
  ]);

  let proofReady = 0;
  let verificationReady = 0;
  let available = 0;
  let scanned = 0;
  let cursorId: string | undefined;

  while (scanned < maxItems) {
    throwIfAborted();
    const take = Math.min(SUMMARY_CHUNK_SIZE, maxItems - scanned);
    const batch = await db.leadInventoryItem.findMany({
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: "asc" },
      select: inventorySummarySelect,
    });
    if (batch.length === 0) break;
    cursorId = batch[batch.length - 1]!.id;

    const uids = [
      ...new Set(
        batch
          .map((item) => item.sourceLeadEvent.sourceLeadUid?.trim())
          .filter((uid): uid is string => Boolean(uid))
      ),
    ];

    throwIfAborted();
    const [proofs, verifications] = await Promise.all([
      uids.length > 0
        ? db.leadProof.findMany({
            where: { leadUid: { in: uids } },
            select: { leadUid: true, proofStatus: true },
          })
        : Promise.resolve([]),
      uids.length > 0
        ? db.leadVerificationResult.findMany({
            where: { leadUid: { in: uids } },
            select: { leadUid: true, verificationStatus: true, duplicateStatus: true },
          })
        : Promise.resolve([]),
    ]);

    const proofByUid = new Map(proofs.map((row) => [row.leadUid, row]));
    const verificationByUid = new Map(verifications.map((row) => [row.leadUid, row]));

    for (const item of batch) {
      const leadUid = item.sourceLeadEvent.sourceLeadUid?.trim() || "";
      const proof = leadUid ? (proofByUid.get(leadUid) ?? null) : null;
      const verification = leadUid ? (verificationByUid.get(leadUid) ?? null) : null;
      if (proof?.proofStatus === "PROOF_ATTACHED") proofReady += 1;
      if (verification?.verificationStatus === "PASSED") verificationReady += 1;

      const availability = evaluateLeadInventoryAvailability({
        item,
        lot: item.inventoryLot,
        sourceLeadEvent: item.sourceLeadEvent,
        leadProof: proof,
        verification,
        activeAllocations: item.leadAllocations,
        ageBands,
        evaluatedAt,
      });
      if (availability.available) available += 1;
    }

    scanned += batch.length;
    if (batch.length < take) break;
  }

  return {
    totalItems,
    available,
    reserved: itemCounts.reserved ?? 0,
    committed: itemCounts.committed ?? 0,
    fulfilled: itemCounts.fulfilled ?? 0,
    quarantined: itemCounts.quarantined ?? 0,
    expired: itemCounts.expired ?? 0,
    lotsActive: lotCounts.active ?? 0,
    lotsPaused: lotCounts.paused ?? 0,
    proofReady,
    verificationReady,
    evaluatedAt: evaluatedAt.toISOString(),
    scannedItems: scanned,
    truncated: scanned < totalItems,
  };
}
