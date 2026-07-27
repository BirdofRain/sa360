/**
 * LOCAL DEMO ONLY — sanitized DB inspection for FOWB rehearsal.
 * Refuses non-localhost DATABASE_URL. Does not print credentials.
 *
 * Requires:
 *   FOWB_ORDER_ID
 *   FOWB_ALLOC_ID
 */
import { PrismaClient } from "@prisma/client";

import { assertLocalDemoDatabaseUrl } from "../lib/local-demo-database-url.js";

async function main() {
  const databaseUrl = assertLocalDemoDatabaseUrl(process.env.DATABASE_URL);
  const orderId = process.env.FOWB_ORDER_ID?.trim();
  const allocId = process.env.FOWB_ALLOC_ID?.trim();
  if (!orderId || !allocId) {
    throw new Error("FOWB_ORDER_ID and FOWB_ALLOC_ID are required for local inspection");
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const lot = await prisma.inventoryLot.findMany({
      where: { lotKey: { startsWith: "lot_fowb_" } },
      select: {
        lotKey: true,
        status: true,
        nicheKey: true,
        sourceLane: true,
        inventoryClass: true,
      },
    });
    const items = await prisma.leadInventoryItem.findMany({
      where: { nicheKey: "vet", normalizedState: "NC" },
      select: {
        id: true,
        status: true,
        nicheKey: true,
        normalizedState: true,
        sourceLane: true,
        inventoryClass: true,
        fulfillmentCount: true,
        maxFulfillments: true,
      },
    });
    const order = await prisma.leadOrder.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        status: true,
        nicheKey: true,
        statesJson: true,
        requestedQuantity: true,
        proposedQuantity: true,
        reservedQuantity: true,
        fulfilledQuantity: true,
        orderKind: true,
        fulfillmentMode: true,
        activatedAt: true,
      },
    });
    const assessments = await prisma.leadEligibilityAssessment.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { status: true, policyKey: true, reasonCodesJson: true },
    });
    const alloc = await prisma.leadAllocation.findUnique({
      where: { id: allocId },
      select: {
        status: true,
        leadOrderId: true,
        leadInventoryItemId: true,
        reservedAt: true,
        idempotencyKey: true,
      },
    });
    const target = await prisma.deliveryTarget.findMany({
      where: { adapterKey: "test.simulated.v1" },
      select: {
        adapterKey: true,
        enabled: true,
        displayName: true,
        clientAccountId: true,
      },
    });
    const instr = await prisma.deliveryInstruction.findMany({
      where: { leadAllocationId: allocId },
      select: { id: true, status: true, sequence: true, deliveryTargetId: true },
    });
    const attempts = await prisma.deliveryAttempt.findMany({
      where: { deliveryInstruction: { leadAllocationId: allocId } },
      select: {
        attemptNumber: true,
        status: true,
        executionMode: true,
        startedAt: true,
        completedAt: true,
        errorCode: true,
      },
    });
    const proofs = await prisma.leadProof.findMany({
      where: { leadUid: { startsWith: "manualimport-aged_inventory_csv-FOWB" } },
      select: { leadUid: true, proofStatus: true, sourceLane: true },
    });
    const vers = await prisma.leadVerificationResult.findMany({
      where: { leadUid: { startsWith: "manualimport-aged_inventory_csv-FOWB" } },
      select: { leadUid: true, verificationStatus: true, duplicateStatus: true },
    });
    const liveAttempts = await prisma.deliveryAttempt.count({
      where: { executionMode: { not: "simulation" } },
    });

    console.log(
      JSON.stringify(
        {
          lot,
          items: items.map((i) => ({ ...i, id: `${i.id.slice(0, 8)}…` })),
          order,
          assessments,
          alloc: alloc
            ? {
                ...alloc,
                leadOrderId: `${alloc.leadOrderId.slice(0, 8)}…`,
                leadInventoryItemId: alloc.leadInventoryItemId
                  ? `${alloc.leadInventoryItemId.slice(0, 8)}…`
                  : null,
              }
            : null,
          target,
          instr: instr.map((row) => ({
            ...row,
            id: `${row.id.slice(0, 8)}…`,
            deliveryTargetId: `${row.deliveryTargetId.slice(0, 8)}…`,
          })),
          attempts,
          proofs: proofs.map((p) => ({
            leadUidMasked: `${p.leadUid.slice(0, 28)}…`,
            proofStatus: p.proofStatus,
            sourceLane: p.sourceLane,
          })),
          verification: vers.map((v) => ({
            leadUidMasked: `${v.leadUid.slice(0, 28)}…`,
            verificationStatus: v.verificationStatus,
            duplicateStatus: v.duplicateStatus,
          })),
          liveAttemptCount_nonSimulation: liveAttempts,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
