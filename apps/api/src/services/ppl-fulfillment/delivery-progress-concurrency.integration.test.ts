/**
 * Local synthetic deliveries only. Proves spreadsheet delivery progress stays
 * aligned with allocation rows when two deliveries race.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { nextLeadOrderNumber } from "../../repositories/lead-order.repository.js";
import { markSpreadsheetDeliveredLineAware } from "./buyer-csv-export-line-pricing.js";

const BUYER = "client_mb_conc_buyer";
const LOT_ID = "mbconc-lot";
const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

function csvFor(phone: string, email: string): string {
  return (
    "Date Generated,Lead Type,First Name,Last Name,Phone,Email,State,Age\n" +
    `2026-08-01,Veteran,Casey,Lead,${phone},${email},WY,55\n`
  );
}

describe("spreadsheet delivery progress concurrency", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const previousExport = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

  before(async () => {
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
    await cleanup(db);
    await db.clientAccount.upsert({
      where: { clientAccountId: BUYER },
      create: {
        clientAccountId: BUYER,
        clientDisplayName: BUYER,
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["vet"],
      },
      update: { status: "active" },
    });
    await db.inventoryLot.create({
      data: {
        id: LOT_ID,
        lotKey: LOT_ID,
        displayName: "MB concurrency lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        nicheKey: "vet",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "active",
        activatedAt: new Date(),
      },
    });
  });

  after(async () => {
    if (db) await cleanup(db);
    await db?.$disconnect();
    if (previousExport === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    else process.env.SA360_PPL_CSV_EXPORT_ENABLED = previousExport;
  });

  it("keeps both line increments when two deliveries commit together", async () => {
    for (let round = 0; round < 5; round += 1) {
      const seeded = await seedOrder(db, `pair-${round}`, 2);
      const results = await Promise.all(
        seeded.packages.map((pkg, index) =>
          markSpreadsheetDeliveredLineAware(
            {
              exportId: pkg.id,
              confirmationPhrase: "MARK SPREADSHEET DELIVERED",
              idempotencyKey: `mbconc-pair-${round}-${index}`,
              deliveredBy: "mbconc",
            },
            db
          )
        )
      );
      assert.deepEqual(
        results.map((result) => result.ok),
        [true, true]
      );
      await assertProgress(db, seeded.orderId, seeded.lineIds, 2, 0, [1, 1]);
      assert.equal(
        await db.buyerDeliveredIdentity.count({
          where: { leadAllocationId: { in: seeded.allocationIds } },
        }),
        2
      );
      assert.equal(
        await db.leadDeliveryExportPackage.count({
          where: { leadOrderId: seeded.orderId, spreadsheetDeliveredAt: { not: null } },
        }),
        2
      );
    }
  });

  it("records one delivery once when two attempts race", async () => {
    const seeded = await seedOrder(db, "same", 1);
    const pkg = seeded.packages[0]!;
    const results = await Promise.all([
      markSpreadsheetDeliveredLineAware(
        {
          exportId: pkg.id,
          confirmationPhrase: "MARK SPREADSHEET DELIVERED",
          idempotencyKey: "mbconc-same-a",
          deliveredBy: "mbconc",
        },
        db
      ),
      markSpreadsheetDeliveredLineAware(
        {
          exportId: pkg.id,
          confirmationPhrase: "MARK SPREADSHEET DELIVERED",
          idempotencyKey: "mbconc-same-b",
          deliveredBy: "mbconc",
        },
        db
      ),
    ]);
    assert.equal(results.every((result) => result.ok), true);
    await assertProgress(db, seeded.orderId, seeded.lineIds, 1, 0, [1]);
    assert.equal(
      await db.buyerDeliveredIdentity.count({
        where: { leadAllocationId: seeded.allocationIds[0] },
      }),
      1
    );
    const replay = await markSpreadsheetDeliveredLineAware(
      {
        exportId: pkg.id,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: "mbconc-same-retry",
        deliveredBy: "mbconc",
      },
      db
    );
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.idempotentReplay, true);
    await assertProgress(db, seeded.orderId, seeded.lineIds, 1, 0, [1]);
    assert.equal(
      await db.buyerDeliveredIdentity.count({
        where: { leadAllocationId: seeded.allocationIds[0] },
      }),
      1
    );
  });

  it("leaves progress and identities unchanged when delivery is refused", async () => {
    const seeded = await seedOrder(db, "refuse", 1);
    const pkg = seeded.packages[0]!;
    const refused = await markSpreadsheetDeliveredLineAware(
      {
        exportId: pkg.id,
        confirmationPhrase: "not the phrase",
        idempotencyKey: "mbconc-refuse-phrase",
        deliveredBy: "mbconc",
      },
      db
    );
    assert.equal(refused.ok, false);
    const holed = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: seeded.orderId,
        clientAccountId: BUYER,
        rowCount: 1,
        contentSha256: "mbconc-hole",
        idempotencyKey: "mbconc-export-hole",
        fieldSchemaVersion: "buyer_csv_v4",
        allocationIdsJson: seeded.allocationIds,
        csvContent: "Date Generated,Lead Type,First Name,Last Name,Phone,Email,State\n2026-08-01,Veteran,Casey,Lead,+12125550199,hole@mbconc.test,WY\n",
        metadataJson: { niche: "vet" },
      },
    });
    const ageRefused = await markSpreadsheetDeliveredLineAware(
      {
        exportId: holed.id,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: "mbconc-refuse-age",
        deliveredBy: "mbconc",
      },
      db
    );
    assert.equal(ageRefused.ok, false);
    await assertProgress(db, seeded.orderId, seeded.lineIds, 0, 1, [0]);
    assert.equal(
      await db.buyerDeliveredIdentity.count({
        where: { leadAllocationId: { in: seeded.allocationIds } },
      }),
      0
    );
    const stored = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    assert.equal(stored.spreadsheetDeliveredAt, null);
    const allocation = await db.leadAllocation.findUniqueOrThrow({
      where: { id: seeded.allocationIds[0] },
    });
    assert.equal(allocation.status, "reserved");
  });
});

async function assertProgress(
  db: PrismaClient,
  orderId: string,
  lineIds: string[],
  fulfilled: number,
  reserved: number,
  lineFulfilled: number[]
) {
  const order = await db.leadOrder.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.fulfilledQuantity, fulfilled);
  assert.equal(order.reservedQuantity, reserved);
  for (let index = 0; index < lineIds.length; index += 1) {
    const line = await db.leadOrderLine.findUniqueOrThrow({ where: { id: lineIds[index] } });
    assert.equal(line.fulfilledQuantity, lineFulfilled[index]);
    assert.equal(line.reservedQuantity, line.requestedQuantity - (lineFulfilled[index] ?? 0));
  }
}

async function seedOrder(db: PrismaClient, tag: string, lineCount: number) {
  const order = await db.leadOrder.create({
    data: {
      orderNumber: await nextLeadOrderNumber(db),
      clientAccountId: BUYER,
      clientDisplayName: BUYER,
      status: "active",
      nicheKey: "vet",
      statesJson: ["WY"],
      leadVolume: lineCount,
      campaignType: "Aged leads",
      crmPackage: "lead_delivery",
      createdByRole: "admin",
      submittedAt: new Date(),
      activatedAt: new Date(),
      paymentConfirmationStatus: "confirmed",
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: lineCount,
      reservedQuantity: lineCount,
      notes: `mbconc ${tag}`,
      orderLines: {
        create: Array.from({ length: lineCount }, (_, index) => ({
          lineNumber: index + 1,
          displayName: `Line ${index + 1}`,
          nicheKey: "vet",
          requestedQuantity: 1,
          reservedQuantity: 1,
          unitPriceCents: index === 0 ? 600 : 400,
          lineTotalCents: index === 0 ? 600 : 400,
          status: "active" as const,
          normalizedStatesJson: ["WY"],
          ageBandKeysJson: [index === 0 ? "COMMERCE_1_3_MO" : "COMMERCE_3_6_MO"],
          metadataJson: {
            schema: "ppl_order_line_pricing_v1",
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            commerceAgeBucketKey: index === 0 ? "COMMERCE_1_3_MO" : "COMMERCE_3_6_MO",
            unitPriceCents: index === 0 ? 600 : 400,
          },
        })),
      },
    },
    include: { orderLines: { orderBy: { lineNumber: "asc" } } },
  });

  const allocationIds: string[] = [];
  const packages = [];
  for (const [index, line] of order.orderLines.entries()) {
    const phone = `+1212555${String(2000 + order.orderLines.length * 10 + index).padStart(4, "0")}`.slice(0, 12);
    const email = `${tag}-${index}@mbconc.test`;
    const eventId = `mbconc-evt-${tag}-${index}`;
    const itemId = `mbconc-item-${tag}-${index}`;
    const body = {
      contact: {
        first_name: "Casey",
        last_name: "Lead",
        phone_e164: phone,
        email,
        state: "WY",
      },
      lead_details: { consumer_age: 55 },
    };
    await db.sourceLeadEvent.create({
      data: {
        id: eventId,
        sourceProvider: "manual_import",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "manual_entry",
        sourceLeadId: `src-${tag}-${index}`,
        status: "approved",
        rawPayloadJson: body,
        normalizedPayloadJson: body,
        receivedAt: new Date(),
      },
    });
    await db.leadInventoryItem.create({
      data: {
        id: itemId,
        inventoryLotId: LOT_ID,
        sourceLeadEventId: eventId,
        generatedAt: new Date(),
        normalizedState: "WY",
        nicheKey: "vet",
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "reserved",
        reservedAt: new Date(),
      },
    });
    const allocation = await db.leadAllocation.create({
      data: {
        sourceLeadEventId: eventId,
        leadOrderId: order.id,
        leadOrderLineId: line.id,
        clientAccountId: BUYER,
        leadInventoryItemId: itemId,
        status: "reserved",
        allocationPolicyVersion: "mbconc",
        idempotencyKey: `mbconc-alloc-${tag}-${index}`,
      },
    });
    allocationIds.push(allocation.id);
    packages.push(
      await db.leadDeliveryExportPackage.create({
        data: {
          leadOrderId: order.id,
          clientAccountId: BUYER,
          rowCount: 1,
          contentSha256: `mbconc-${tag}-${index}`,
          idempotencyKey: `mbconc-export-${tag}-${index}`,
          fieldSchemaVersion: "buyer_csv_v4",
          allocationIdsJson: [allocation.id],
          csvContent: csvFor(phone, email),
          metadataJson: { niche: "vet" },
        },
      })
    );
  }
  return { orderId: order.id, lineIds: order.orderLines.map((line) => line.id), allocationIds, packages };
}

async function cleanup(db: PrismaClient) {
  const orders = await db.leadOrder.findMany({
    where: { clientAccountId: BUYER, notes: { contains: "mbconc" } },
    select: { id: true },
  });
  const orderIds = orders.map((row) => row.id);
  if (orderIds.length > 0) {
    await db.leadDeliveryExportPackage.deleteMany({ where: { leadOrderId: { in: orderIds } } });
    await db.leadAllocation.deleteMany({ where: { leadOrderId: { in: orderIds } } });
    await db.leadOrderLine.deleteMany({ where: { leadOrderId: { in: orderIds } } });
    await db.leadOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  await db.buyerDeliveredIdentity.deleteMany({
    where: { OR: [{ clientAccountId: BUYER }, { sourceLeadEventId: { startsWith: "mbconc-evt-" } }] },
  });
  await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: "mbconc-item-" } } });
  await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: "mbconc-evt-" } } });
  await db.inventoryLot.deleteMany({ where: { id: LOT_ID } });
}
