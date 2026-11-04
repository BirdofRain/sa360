/**
 * Approve & Release recording for a 1,200-row package.
 * The previous per-allocation update loop expired Prisma's default 5s
 * interactive transaction and rolled the release back (P2028).
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import { markSpreadsheetDelivered } from "./buyer-csv-export.service.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);
const PACKAGE_ROWS = 1_200;

describe("buyer CSV release recording", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const stamp = `${Date.now()}`;
  const clientAccountId = `relrec_${stamp}`;
  const createdOrderIds: string[] = [];

  before(async () => {
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED = "true";
    process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED = "false";
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
  });

  after(async () => {
    if (!db) return;
    await db.buyerDeliveredIdentity.deleteMany({ where: { clientAccountId } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId } });
    if (createdOrderIds.length > 0) {
      await db.leadDeliveryExportPackage.deleteMany({ where: { leadOrderId: { in: createdOrderIds } } });
      await db.leadAllocation.deleteMany({ where: { leadOrderId: { in: createdOrderIds } } });
    }
    await db.leadInventoryItem.deleteMany({ where: { inventoryLot: { lotKey: { startsWith: `relrec-${stamp}` } } } });
    await db.sourceLeadEvent.deleteMany({ where: { sourceLeadId: { startsWith: `relrec-${stamp}-` } } });
    await db.inventoryLot.deleteMany({ where: { lotKey: { startsWith: `relrec-${stamp}` } } });
    await db.leadOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    await db.$disconnect();
  });

  async function seedPackage(rowCount: number, label: string) {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `RELREC-${label}-${stamp}`,
        clientAccountId,
        clientDisplayName: "Release Recording",
        status: "active",
        nicheKey: "vet",
        statesJson: ["FL", "OH", "TN", "TX", "CO"],
        leadVolume: rowCount,
        deliveryCadence: "manual_csv_fulfillment",
        campaignType: "release_recording_test",
        crmPackage: "manual_csv_only",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: rowCount,
        proposedQuantity: rowCount,
        reservedQuantity: rowCount,
        fulfilledQuantity: 0,
      },
    });
    createdOrderIds.push(order.id);
    const lot = await db.inventoryLot.create({
      data: {
        lotKey: `relrec-${stamp}-${label}`,
        displayName: `Release recording ${label}`,
        sourceProvider: "manual_import",
        sourceLane: "aged_inventory_bulk_csv",
        nicheKey: "vet",
        inventoryClass: "aged",
        status: "active",
      },
    });
    const events = Array.from({ length: rowCount }, (_, index) => ({
      sourceProvider: "manual_import" as const,
      sourceSystem: "csv_import" as const,
      sourceType: "bulk_import" as const,
      sourceLeadId: `relrec-${stamp}-${label}-${index}`,
      rawPayloadJson: {},
      normalizedPayloadJson: {
        phoneE164: `+1555${String(index).padStart(7, "0")}`,
        email: `lead-${label}-${index}@release-test.example`,
      },
    }));
    for (let offset = 0; offset < events.length; offset += 300) {
      await db.sourceLeadEvent.createMany({ data: events.slice(offset, offset + 300) });
    }
    const storedEvents = await db.sourceLeadEvent.findMany({
      where: { sourceLeadId: { startsWith: `relrec-${stamp}-${label}-` } },
      select: { id: true, sourceLeadId: true },
    });
    assert.equal(storedEvents.length, rowCount);
    const generatedAt = new Date("2024-06-01T00:00:00.000Z");
    const items = storedEvents.map((event) => ({
      inventoryLotId: lot.id,
      sourceLeadEventId: event.id,
      generatedAt,
      normalizedState: "FL",
      nicheKey: "vet",
      sourceProvider: "manual_import" as const,
      sourceLane: "aged_inventory_bulk_csv",
      inventoryClass: "aged" as const,
      status: "reserved" as const,
      reservedAt: new Date("2026-11-04T14:07:13.152Z"),
    }));
    for (let offset = 0; offset < items.length; offset += 300) {
      await db.leadInventoryItem.createMany({ data: items.slice(offset, offset + 300) });
    }
    const storedItems = await db.leadInventoryItem.findMany({
      where: { inventoryLotId: lot.id },
      select: { id: true, sourceLeadEventId: true },
    });
    const reservedAt = new Date("2026-11-04T14:07:13.152Z");
    const allocations = storedItems.map((item, index) => ({
      sourceLeadEventId: item.sourceLeadEventId,
      leadOrderId: order.id,
      leadInventoryItemId: item.id,
      clientAccountId,
      status: "reserved" as const,
      allocationPolicyVersion: "release-recording-test",
      idempotencyKey: `relrec-${stamp}-${label}-alloc-${index}`,
      reservedAt,
    }));
    for (let offset = 0; offset < allocations.length; offset += 300) {
      await db.leadAllocation.createMany({ data: allocations.slice(offset, offset + 300) });
    }
    const allocationRows = await db.leadAllocation.findMany({
      where: { leadOrderId: order.id },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    assert.equal(allocationRows.length, rowCount);
    const contentSha256 = "7518a0f5c13602855c67d7b51d1a4e2674bd610eecd1c769aa7ab19acfa49055";
    const csvContent = "Age\n72\n";
    const packageRow = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: order.id,
        clientAccountId,
        format: "csv_v1",
        rowCount,
        contentSha256,
        idempotencyKey: `relrec-${stamp}-${label}-export`,
        fieldSchemaVersion: "buyer_csv_v4",
        allocationIdsJson: allocationRows.map((row) => row.id),
        csvContent,
        metadataJson: { niche: "vet" },
        createdBy: "release-recording-test",
      },
    });
    return { order, packageRow, allocationIds: allocationRows.map((row) => row.id), contentSha256, csvContent };
  }

  it("rolls a timed-out per-row release back, then the set-based release records it once", async () => {
    const seeded = await seedPackage(1, "timeout");
    let caught: unknown = null;
    try {
      await db.$transaction(async (tx) => {
        await tx.leadDeliveryExportPackage.updateMany({
          where: { id: seeded.packageRow.id, spreadsheetDeliveredAt: null },
          data: {
            spreadsheetDeliveredAt: new Date(),
            spreadsheetDeliveryIdempotencyKey: `relrec-${stamp}-timeout-partial`,
            customerReleaseNotifyStatus: "pending",
          },
        });
        const allocation = await tx.leadAllocation.findFirstOrThrow({
          where: { leadOrderId: seeded.order.id },
        });
        await tx.buyerDeliveredIdentity.create({
          data: {
            clientAccountId,
            sourceLeadEventId: allocation.sourceLeadEventId,
            leadAllocationId: allocation.id,
            leadInventoryItemId: allocation.leadInventoryItemId,
          },
        });
        // The callback does not pass a timeout, so Prisma's 5000 ms default
        // applies. A later query, after that budget, is the operation that
        // fails. The package stamp and identity insert above are in this
        // same transaction and must roll back with it.
        await new Promise((resolve) => setTimeout(resolve, 5_200));
        for (let step = 0; step < 3; step += 1) {
          await tx.leadAllocation.updateMany({
            where: { id: allocation.id, status: "reserved" },
            data: { reservedAt: new Date() },
          });
        }
      });
    } catch (err) {
      caught = err;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    const code = caught instanceof Prisma.PrismaClientKnownRequestError ? caught.code : "";
    writeFileSync(
      "/opt/cursor/artifacts/p2028-reproduction.txt",
      `code=${code}\n${message}\n`
    );
    assert.ok(caught instanceof Prisma.PrismaClientKnownRequestError);
    assert.equal(caught.code, "P2028");
    assert.match(message, /5000 ms/);
    assert.match(message, /expired transaction|Transaction already closed|Transaction API error/i);

    const rolledBack = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: seeded.packageRow.id },
    });
    assert.equal(rolledBack.spreadsheetDeliveredAt, null);
    assert.equal(rolledBack.spreadsheetDeliveryIdempotencyKey, null);
    assert.equal(rolledBack.customerReleaseNotifyStatus, null);
    assert.equal(await db.buyerDeliveredIdentity.count({ where: { clientAccountId, leadAllocationId: { in: seeded.allocationIds } } }), 0);
    assert.equal(
      (await db.leadAllocation.findFirstOrThrow({ where: { leadOrderId: seeded.order.id } })).status,
      "reserved"
    );

    const sendCalls: SendTransactionalEmailInput[] = [];
    const released = await markSpreadsheetDelivered(
      {
        exportId: seeded.packageRow.id,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `relrec-${stamp}-timeout-release`,
        deliveredBy: "release-recording-test",
      },
      db,
      { send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "should-not-send" };
      } }
    );
    assert.equal(released.ok, true);
    if (!released.ok) return;
    assert.equal(released.idempotentReplay, false);
    assert.equal(released.externalWriteOccurred, false);
    assert.equal(released.customerNotification?.status, "skipped");
    assert.equal(sendCalls.length, 0);
    assert.equal(await db.buyerDeliveredIdentity.count({ where: { leadAllocationId: { in: seeded.allocationIds } } }), 1);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { exportPackageId: seeded.packageRow.id } }), 0);
  });

  it("records a 1,200-row package inside the default transaction budget and replays without a second write", async () => {
    const seeded = await seedPackage(PACKAGE_ROWS, "bulk");
    const sendCalls: SendTransactionalEmailInput[] = [];
    const send = async (input: SendTransactionalEmailInput) => {
      sendCalls.push(input);
      return { ok: true as const, id: "should-not-send" };
    };
    const started = Date.now();
    const [first, second] = await Promise.all([
      markSpreadsheetDelivered(
        {
          exportId: seeded.packageRow.id,
          confirmationPhrase: "MARK SPREADSHEET DELIVERED",
          idempotencyKey: `relrec-${stamp}-bulk-a`,
          deliveredBy: "release-recording-test",
        },
        db,
        { send }
      ),
      markSpreadsheetDelivered(
        {
          exportId: seeded.packageRow.id,
          confirmationPhrase: "MARK SPREADSHEET DELIVERED",
          idempotencyKey: `relrec-${stamp}-bulk-b`,
          deliveredBy: "release-recording-test",
        },
        db,
        { send }
      ),
    ]);
    const elapsedMs = Date.now() - started;
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal([first, second].filter((result) => !result.idempotentReplay).length, 1);
    assert.ok(elapsedMs < 5_000, `1200-row release took ${elapsedMs}ms`);
    assert.equal(sendCalls.length, 0);
    assert.equal(first.externalWriteOccurred, false);
    assert.equal(second.externalWriteOccurred, false);

    const stored = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: seeded.packageRow.id },
    });
    assert.ok(stored.spreadsheetDeliveredAt);
    assert.equal(stored.contentSha256, seeded.contentSha256);
    assert.equal(stored.csvContent, seeded.csvContent);
    assert.equal(stored.rowCount, PACKAGE_ROWS);
    assert.equal(stored.customerReleaseNotifyStatus, "skipped");
    const winnerKey = [first, second].find((result) => !result.idempotentReplay);
    assert.ok(winnerKey);
    assert.equal(
      stored.spreadsheetDeliveryIdempotencyKey,
      winnerKey === first ? `relrec-${stamp}-bulk-a` : `relrec-${stamp}-bulk-b`
    );
    assert.equal(await db.leadAllocation.count({ where: { leadOrderId: seeded.order.id, status: "committed" } }), PACKAGE_ROWS);
    assert.equal(await db.leadAllocation.count({ where: { leadOrderId: seeded.order.id, status: "reserved" } }), 0);
    assert.equal(
      await db.leadInventoryItem.count({
        where: { leadAllocations: { some: { leadOrderId: seeded.order.id } }, status: "committed" },
      }),
      PACKAGE_ROWS
    );
    assert.equal(
      await db.buyerDeliveredIdentity.count({ where: { leadAllocationId: { in: seeded.allocationIds } } }),
      PACKAGE_ROWS
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId, exportPackageId: seeded.packageRow.id } }), 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId, exportPackageId: seeded.packageRow.id } }), 0);

    const identitiesBeforeReplay = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: seeded.allocationIds } },
    });
    const replay = await markSpreadsheetDelivered(
      {
        exportId: seeded.packageRow.id,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: stored.spreadsheetDeliveryIdempotencyKey ?? `relrec-${stamp}-bulk-a`,
        deliveredBy: "release-recording-test",
      },
      db,
      { send }
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.externalWriteOccurred, false);
    assert.equal(replay.deliveredAt, stored.spreadsheetDeliveredAt?.toISOString());
    assert.equal(sendCalls.length, 0);
    assert.equal(
      await db.buyerDeliveredIdentity.count({ where: { leadAllocationId: { in: seeded.allocationIds } } }),
      identitiesBeforeReplay
    );
    const afterReplay = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: seeded.packageRow.id },
    });
    assert.equal(afterReplay.spreadsheetDeliveredAt?.toISOString(), stored.spreadsheetDeliveredAt?.toISOString());
    assert.equal(afterReplay.csvContent, seeded.csvContent);
    writeFileSync(
      "/opt/cursor/artifacts/release-recording-1200.txt",
      `elapsedMs=${elapsedMs}\nrowCount=${PACKAGE_ROWS}\nidentityCount=${PACKAGE_ROWS}\nsha256=${stored.contentSha256}\n`
    );
  });
});
