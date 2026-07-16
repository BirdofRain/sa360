import type { PrismaClient } from "@prisma/client";

import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { assessLeadInventoryActivationEligibility } from "./lead-inventory-review-eligibility.service.js";

export async function loadReviewItemsWithEligibility(
  itemIds: string[],
  db: PrismaClient,
  evaluatedAt: Date = new Date()
) {
  const ageBands = await listActiveAgeBandDefinitions(undefined, db);
  const items = await db.leadInventoryItem.findMany({
    where: { id: { in: itemIds } },
    include: {
      inventoryLot: true,
      sourceLeadEvent: true,
      leadAllocations: {
        include: {
          deliveryInstructions: {
            include: {
              deliveryAttempts: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const byId = new Map(items.map((item) => [item.id, item]));
  const results = [];

  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    if (!item) {
      results.push({
        itemId,
        found: false as const,
        eligibility: null,
        item: null,
      });
      continue;
    }

    const leadUid = item.sourceLeadEvent.sourceLeadUid;
    const [proof, verification] = await Promise.all([
      leadUid
        ? db.leadProof.findUnique({ where: { leadUid }, select: { proofStatus: true } })
        : Promise.resolve(null),
      leadUid
        ? db.leadVerificationResult.findUnique({
            where: { leadUid },
            select: { verificationStatus: true, duplicateStatus: true },
          })
        : Promise.resolve(null),
    ]);

    const allocations = item.leadAllocations.map((allocation) => ({
      id: allocation.id,
      status: allocation.status,
      leadInventoryItemId: allocation.leadInventoryItemId,
      releasedAt: allocation.releasedAt,
      deliveryInstructionCount: allocation.deliveryInstructions.length,
      deliveryAttemptCount: allocation.deliveryInstructions.reduce(
        (sum, instruction) => sum + instruction.deliveryAttempts.length,
        0
      ),
    }));

    const eligibility = assessLeadInventoryActivationEligibility({
      item,
      lot: item.inventoryLot,
      sourceLeadEvent: item.sourceLeadEvent,
      leadProof: proof,
      verification,
      allocations,
      ageBands,
      evaluatedAt,
    });

    results.push({
      itemId,
      found: true as const,
      eligibility,
      item,
    });
  }

  return { ageBands, results, evaluatedAt };
}
