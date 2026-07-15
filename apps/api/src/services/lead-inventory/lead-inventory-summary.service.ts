import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import { evaluateLeadInventoryAvailability } from "./lead-inventory-availability.service.js";
import {
  countInventoryItemsByStatus,
  countInventoryLotsByStatus,
  listActiveAgeBandDefinitions,
} from "../../repositories/lead-inventory.repository.js";

export async function buildLeadInventorySummary(db: PrismaClient = defaultPrisma) {
  const evaluatedAt = new Date();
  const [itemCounts, lotCounts, items, ageBands] = await Promise.all([
    countInventoryItemsByStatus(db),
    countInventoryLotsByStatus(db),
    db.leadInventoryItem.findMany({
      select: {
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
        leadAllocations: { select: { status: true } },
      },
    }),
    listActiveAgeBandDefinitions(undefined, db),
  ]);

  let proofReady = 0;
  let verificationReady = 0;
  let available = 0;

  for (const item of items) {
    const leadUid = item.sourceLeadEvent.sourceLeadUid;
    const [proof, verification] = await Promise.all([
      leadUid ? getLeadProofByLeadUid(leadUid, db) : null,
      leadUid
        ? db.leadVerificationResult.findUnique({ where: { leadUid } })
        : null,
    ]);
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

  const totalItems = items.length;
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
  };
}
