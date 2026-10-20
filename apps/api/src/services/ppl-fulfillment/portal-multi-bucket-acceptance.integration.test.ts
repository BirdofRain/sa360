/**
 * Local synthetic inventory only. Proves multi-bucket ordering, line pricing,
 * and delivery counters against SA360_TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue, fingerprintPhoneIdentity } from "../../lib/identity-fingerprint.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { nextLeadOrderNumber } from "../../repositories/lead-order.repository.js";
import { reserveLeadAllocationAtomicTx } from "../fulfillment-execution/reservation.service.js";
import {
  approveLeadOrder,
  confirmLeadOrderPayment,
  createClientLeadOrder,
  getClientLeadOrder,
} from "../lead-order/lead-order.service.js";
import { presentLeadOrderDetail } from "../lead-order/lead-order-present.service.js";
import type { PortalOrderIdempotencyStore } from "../lead-order/portal-order-idempotency.js";
import { presentFulfillmentOpsOrderWithPricing } from "../fulfillment-ops/fulfillment-ops.service.js";
import { findLeadOrderById } from "../../repositories/lead-order.repository.js";
import {
  commitLineAwareBuyerCsvExport,
  markSpreadsheetDeliveredLineAware,
} from "./buyer-csv-export-line-pricing.js";
import { getBuyerCsvExportDownload } from "./buyer-csv-export.service.js";
import {
  commitPplInventorySelection,
  previewPplInventorySelection,
  PPL_ALLOCATION_POLICY_VERSION,
} from "./inventory-selection.service.js";
import {
  lookupPortalBuyerAvailability,
  resetPortalBuyerAvailabilityCache,
} from "./portal-buyer-availability.js";

const BUYER = "client_mb_accept_buyer";
const ORIGIN = "client_mb_accept_origin";
const LOT_ID = "mbaccept-lot";
const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const CANDIDATE_STATES = ["WY", "AK", "HI", "VT", "RI", "DE", "ND", "SD", "MT", "ME"] as const;
type AcceptanceState = (typeof CANDIDATE_STATES)[number];

function memoryStore(): PortalOrderIdempotencyStore {
  const values = new Map<string, string>();
  return {
    async claim(key) {
      const existing = values.get(key);
      if (existing) return existing;
      values.set(key, "pending");
      return "acquired";
    },
    async complete(key, orderId) {
      values.set(key, orderId);
    },
    async release(key) {
      if (values.get(key) === "pending") values.delete(key);
    },
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function payload(input: { first: string; phone: string; email: string; state: string }) {
  return {
    contact: {
      first_name: input.first,
      last_name: "Lead",
      phone_e164: input.phone,
      email: input.email,
      state: input.state,
    },
    lead_details: { consumer_age: 55 },
  };
}

describe("populated multi-bucket portal acceptance", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const previousSelection = process.env.SA360_PPL_SELECTION_ENABLED;
  const previousExport = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

  before(async () => {
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
    await cleanup(db);
  });

  after(async () => {
    if (db) await cleanup(db);
    await db?.$disconnect();
    if (previousSelection === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
    else process.env.SA360_PPL_SELECTION_ENABLED = previousSelection;
    if (previousExport === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    else process.env.SA360_PPL_CSV_EXPORT_ENABLED = previousExport;
  });

  it("prices, reserves, exports, and delivers each bucket from local inventory", async () => {
    const state = await emptyState(db);
    await seedClients(db);
    const lot = LOT_ID;
    await db.inventoryLot.create({
      data: {
        id: lot,
        lotKey: lot,
        displayName: "MB accept lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        nicheKey: "vet",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "active",
        activatedAt: new Date(),
      },
    });

    const youngA = await seedItem(db, { tag: "young-a", state, ageDays: 60, phone: "+12125550101", origin: ORIGIN });
    const youngB = await seedItem(db, { tag: "young-b", state, ageDays: 50, phone: "+12125550102", origin: ORIGIN });
    const unstamped = await seedItem(db, { tag: "unstamped", state, ageDays: 40, phone: "+12125550103", origin: null });
    await seedItem(db, { tag: "same-origin", state, ageDays: 55, phone: "+12125550104", origin: BUYER });
    const prior = await seedItem(db, { tag: "prior", state, ageDays: 58, phone: "+12125550105", origin: ORIGIN });
    const priorDupe = await seedItem(db, { tag: "prior-dupe", state, ageDays: 52, phone: "+12125550105", origin: ORIGIN });
    await db.leadInventoryItem.update({ where: { id: prior.itemId }, data: { status: "committed", committedAt: new Date() } });
    await db.buyerDeliveredIdentity.create({
      data: {
        clientAccountId: BUYER,
        phoneFingerprint: fingerprintPhoneIdentity(prior.phone),
        emailFingerprint: fingerprintIdentityValue("email", prior.email),
        sourceLeadEventId: prior.eventId,
        leadAllocationId: "mbaccept-prior-alloc",
        leadInventoryItemId: prior.itemId,
      },
    });
    const older = await seedItem(db, { tag: "older", state, ageDays: 120, phone: "+12125550106", origin: ORIGIN });
    const capA = await seedItem(db, { tag: "cap-a", state, ageDays: 200, phone: "+12125550107", origin: ORIGIN });
    const capB = await seedItem(db, { tag: "cap-b", state, ageDays: 201, phone: "+12125550108", origin: ORIGIN });
    const shared = await seedItem(db, { tag: "shared", state, ageDays: 202, phone: "+12125550109", origin: ORIGIN });

    resetPortalBuyerAvailabilityCache();
    const availability = await lookupPortalBuyerAvailability(
      {
        clientAccountId: BUYER,
        nicheKey: "vet",
        states: [state],
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
      },
      { lookup: undefined }
    );
    assert.equal(availability.ok, true);
    if (!availability.ok) return;
    assert.equal("buyer" in availability, false);
    assert.equal(availability.stateMatrix, null);
    const youngCount = availability.buckets.find((row) => row.commerceAgeBucketKey === "COMMERCE_1_3_MO");
    const olderCount = availability.buckets.find((row) => row.commerceAgeBucketKey === "COMMERCE_3_6_MO");
    assert.equal(youngCount?.eligible, 2);
    assert.equal(youngCount?.display, "estimate");
    assert.equal(olderCount?.eligible, 1);
    assert.equal(olderCount?.display, "estimate");

    const store = memoryStore();
    const orderBody = {
      nicheKey: "vet",
      states: [state],
      leadVolume: 4,
      campaignType: "Aged leads",
      crmPackage: "lead_delivery",
      aiVoiceAddon: false,
      deliveryDestinationLabel: "Synthetic CRM",
      notes: "mbaccept synthetic order",
      shortfallPolicy: "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT" as const,
      idempotencyKey: "portal-order-mbaccept1",
      lines: [
        { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
        { commerceAgeBucketKey: "COMMERCE_3_6_MO", requestedQuantity: 2 },
      ],
    };
    const created = await createClientLeadOrder(orderBody, BUYER, {
      multiBucketEnabled: true,
      idempotencyStore: store,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const duplicate = await createClientLeadOrder(orderBody, BUYER, {
      multiBucketEnabled: true,
      idempotencyStore: store,
    });
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.row.id, created.row.id);
    assert.equal(created.row.paymentConfirmationStatus, "pending_confirmation");
    const orderCount = await db.leadOrder.count({
      where: { clientAccountId: BUYER, notes: { contains: "mbaccept synthetic order" } },
    });
    assert.equal(orderCount, 1);

    const tooSoon = await approveLeadOrder(created.row.id);
    assert.equal(tooSoon.ok, false);
    if (!tooSoon.ok) {
      assert.equal("error" in tooSoon ? tooSoon.error : "not_found", "payment_confirmation_required");
    }
    const paid = await confirmLeadOrderPayment(created.row.id, "mbaccept-operator");
    assert.equal(paid.ok, true);
    if (!paid.ok) return;
    assert.equal(paid.row.paymentConfirmationStatus, "confirmed");
    const approved = await approveLeadOrder(created.row.id);
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.row.status, "ready");
    const { activateFulfillmentOpsOrder } = await import("../fulfillment-ops/fulfillment-ops.service.js");
    const activated = await activateFulfillmentOpsOrder(created.row.id, db);
    assert.equal(activated.ok, true);
    if (!activated.ok) return;
    assert.equal(activated.order.orderTotalCents, 2000);
    assert.equal(activated.order.pricing, null);
    assert.equal(activated.order.requestedQuantity, 4);

    const lines = await db.leadOrderLine.findMany({
      where: { leadOrderId: created.row.id },
      orderBy: { lineNumber: "asc" },
    });
    assert.equal(lines.length, 2);
    const youngLine = lines[0]!;
    const olderLine = lines[1]!;
    assert.equal(youngLine.unitPriceCents, 600);
    assert.equal(youngLine.lineTotalCents, 1200);
    assert.equal(olderLine.unitPriceCents, 400);
    assert.equal(olderLine.lineTotalCents, 800);

    const preview = await previewPplInventorySelection(
      {
        orderId: created.row.id,
        leadOrderLineId: youngLine.id,
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
      },
      db
    );
    assert.equal(preview.ok, true, JSON.stringify(preview));
    if (!preview.ok) return;
    assert.equal(preview.eligibleQuantity, 3);
    assert.equal(preview.selectedItemIds?.includes(unstamped.itemId), false);
    assert.deepEqual(preview.selectedItemIds, [youngA.itemId, youngB.itemId]);
    assert.equal(preview.selectedItemIds?.includes(priorDupe.itemId), false);
    assert.equal(preview.exclusionCounts?.originClient, 1);
    assert.ok((preview.exclusionCounts?.sameBuyerPriorDelivery ?? 0) >= 1);
    assert.equal(preview.unitPriceCents, 600);

    const olderFill = await commitPplInventorySelection(
      {
        orderId: created.row.id,
        leadOrderLineId: olderLine.id,
        commerceAgeBucketKeys: ["COMMERCE_3_6_MO"],
        requestedQuantity: 2,
        idempotencyKey: "mbaccept-select-older",
      },
      db
    );
    assert.equal(olderFill.ok, true);
    if (!olderFill.ok) return;
    assert.equal(olderFill.selectedQuantity, 1);
    assert.equal(olderFill.shortfallQuantity, 1);
    assert.equal(olderFill.unitPriceCents, 400);
    assert.deepEqual(olderFill.selectedItemIds, [older.itemId]);

    const substituted = await commitPplInventorySelection(
      {
        orderId: created.row.id,
        leadOrderLineId: olderLine.id,
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
        idempotencyKey: "mbaccept-select-substituted",
      },
      db
    );
    assert.equal(substituted.ok, false);
    if (!substituted.ok) assert.equal(substituted.code, "priced_bucket_mismatch");

    const youngFill = await commitPplInventorySelection(
      {
        orderId: created.row.id,
        leadOrderLineId: youngLine.id,
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
        idempotencyKey: "mbaccept-select-young",
      },
      db
    );
    assert.equal(youngFill.ok, true);
    if (!youngFill.ok) return;
    assert.equal(youngFill.selectedQuantity, 2);
    assert.equal(youngFill.shortfallQuantity, 0);
    assert.equal(youngFill.unitPriceCents, 600);
    assert.deepEqual(youngFill.selectedItemIds, [youngA.itemId, youngB.itemId]);
    const replay = await commitPplInventorySelection(
      {
        orderId: created.row.id,
        leadOrderLineId: youngLine.id,
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
        idempotencyKey: "mbaccept-select-young",
      },
      db
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.deepEqual(replay.allocationIds, youngFill.allocationIds);
    const reservedYoung = await db.leadAllocation.count({
      where: { leadOrderLineId: youngLine.id, status: "reserved" },
    });
    assert.equal(reservedYoung, 2);
    assert.equal(
      await db.leadInventoryItem.count({
        where: { id: unstamped.itemId, status: "available" },
      }),
      1
    );

    const exported = await commitLineAwareBuyerCsvExport(
      { orderId: created.row.id, idempotencyKey: "mbaccept-export-1", createdBy: "mbaccept" },
      db
    );
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    assert.equal(exported.rowCount, 3);
    assert.equal(exported.linePricing.requestedTotalCents, 2000);
    assert.equal(exported.linePricing.exportedTotalCents, 1600);
    assert.equal(exported.linePricing.unitPriceCents, null);
    assert.equal(exported.linePricing.commerceAgeBucketKey, null);
    assert.equal(exported.filename.includes("1-3mo"), false);
    assert.equal(exported.filename.includes("3-6mo"), false);
    const prices = new Map(
      exported.linePricing.allocations.map((row) => [row.allocationId, row.unitPriceCents])
    );
    const storedAllocations = await db.leadAllocation.findMany({
      where: { id: { in: exported.allocationIds } },
      select: { id: true, leadOrderLineId: true },
    });
    for (const allocation of storedAllocations) {
      const expected = allocation.leadOrderLineId === youngLine.id ? 600 : 400;
      assert.equal(prices.get(allocation.id), expected);
    }
    const packageRow = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: exported.exportId },
    });
    const metadata = packageRow.metadataJson as { unitPriceCents: number | null; linePricing: { exportedTotalCents: number } };
    assert.equal(metadata.unitPriceCents, null);
    assert.equal(metadata.linePricing.exportedTotalCents, 1600);
    const download = await getBuyerCsvExportDownload(exported.exportId, db);
    assert.equal(download.ok, true);
    if (!download.ok) return;
    assert.equal(download.filename.includes("1-3mo"), false);
    assert.equal(download.filename.includes("3-6mo"), false);
    const exportReplay = await commitLineAwareBuyerCsvExport(
      { orderId: created.row.id, idempotencyKey: "mbaccept-export-1" },
      db
    );
    assert.equal(exportReplay.ok, true);
    if (!exportReplay.ok) return;
    assert.equal(exportReplay.exportId, exported.exportId);
    assert.equal(exportReplay.idempotentReplay, true);
    assert.equal(
      await db.leadDeliveryExportPackage.count({ where: { leadOrderId: created.row.id } }),
      1
    );
    const replayedPackage = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: exported.exportId },
    });
    const replayedMetadata = replayedPackage.metadataJson as {
      unitPriceCents: number | null;
      linePricing: { exportedTotalCents: number };
    };
    assert.equal(replayedMetadata.unitPriceCents, null);
    assert.equal(replayedMetadata.linePricing.exportedTotalCents, 1600);
    const replayDownload = await getBuyerCsvExportDownload(exported.exportId, db);
    assert.equal(replayDownload.ok, true);
    if (!replayDownload.ok) return;
    assert.equal(replayDownload.filename.includes("1-3mo"), false);
    assert.equal(replayDownload.filename.includes("3-6mo"), false);

    const delivered = await markSpreadsheetDeliveredLineAware(
      {
        exportId: exported.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: "mbaccept-deliver-1",
        deliveredBy: "mbaccept",
      },
      db
    );
    assert.equal(delivered.ok, true);
    if (!delivered.ok) return;
    assert.equal(delivered.idempotentReplay, false);
    const retried = await markSpreadsheetDeliveredLineAware(
      {
        exportId: exported.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: "mbaccept-deliver-2",
        deliveredBy: "mbaccept",
      },
      db
    );
    assert.equal(retried.ok, true);
    if (!retried.ok) return;
    assert.equal(retried.idempotentReplay, true);
    assert.equal(
      await db.buyerDeliveredIdentity.count({
        where: { clientAccountId: BUYER, leadAllocationId: { in: exported.allocationIds } },
      }),
      exported.allocationIds.length
    );
    const fulfilledOrder = await db.leadOrder.findUniqueOrThrow({ where: { id: created.row.id } });
    assert.equal(fulfilledOrder.fulfilledQuantity, 3);
    assert.equal(fulfilledOrder.reservedQuantity, 0);
    const fulfilledLines = await db.leadOrderLine.findMany({
      where: { leadOrderId: created.row.id },
      orderBy: { lineNumber: "asc" },
    });
    assert.equal(fulfilledLines[0]?.fulfilledQuantity, 2);
    assert.equal(fulfilledLines[1]?.fulfilledQuantity, 1);

    const customer = await getClientLeadOrder(created.row.id, BUYER);
    assert.ok(customer);
    const customerView = presentLeadOrderDetail(customer!, "client") as {
      orderTotalCents: number | null;
      pricedPpl: unknown;
      fulfillment: { fulfilledQuantity: number; requestedQuantity: number } | null;
      lines: Array<{ unitPriceCents: number; fulfilledQuantity: number; shortfallQuantity: number }>;
    };
    assert.equal(customerView.orderTotalCents, 2000);
    assert.equal(customerView.pricedPpl, null);
    assert.equal(customerView.fulfillment?.fulfilledQuantity, 3);
    assert.equal(customerView.fulfillment?.requestedQuantity, 4);
    assert.equal(customerView.lines[0]?.unitPriceCents, 600);
    assert.equal(customerView.lines[0]?.fulfilledQuantity, 2);
    assert.equal(customerView.lines[1]?.unitPriceCents, 400);
    assert.equal(customerView.lines[1]?.fulfilledQuantity, 1);
    assert.equal(customerView.lines[1]?.shortfallQuantity, 1);

    const adminRow = await findLeadOrderById(created.row.id, db);
    assert.ok(adminRow);
    const admin = await presentFulfillmentOpsOrderWithPricing(adminRow!, db);
    assert.equal(admin.orderTotalCents, 2000);
    assert.equal(admin.pricing, null);
    assert.equal(admin.fulfilledQuantity, 3);
    assert.equal(admin.lines[0]?.fulfilledQuantity, 2);
    assert.equal(admin.lines[1]?.fulfilledQuantity, 1);
    assert.equal(admin.lines[0]?.unitPriceCents, 600);
    assert.equal(admin.lines[1]?.unitPriceCents, 400);

    await proveLineCapacity(db, state, capA.itemId, capA.eventId, capB.itemId, capB.eventId);
    await proveInventoryLock(db, state, shared.itemId, shared.eventId);
  });
});

async function emptyState(db: PrismaClient): Promise<AcceptanceState> {
  for (const state of CANDIDATE_STATES) {
    const count = await db.leadInventoryItem.count({
      where: { normalizedState: state, nicheKey: "vet", inventoryClass: "aged" },
    });
    if (count === 0) return state;
  }
  throw new Error("no empty local state for the acceptance fixture");
}

async function seedClients(db: PrismaClient) {
  for (const clientAccountId of [BUYER, ORIGIN]) {
    await db.clientAccount.upsert({
      where: { clientAccountId },
      create: {
        clientAccountId,
        clientDisplayName: clientAccountId,
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["vet"],
      },
      update: { status: "active" },
    });
  }
}

async function seedItem(
  db: PrismaClient,
  input: { tag: string; state: string; ageDays: number; phone: string; origin: string | null }
) {
  const eventId = `mbaccept-evt-${input.tag}`;
  const itemId = `mbaccept-item-${input.tag}`;
  const email = `${input.tag}@mbaccept.test`;
  const body = payload({ first: "Casey", phone: input.phone, email, state: input.state });
  await db.sourceLeadEvent.create({
    data: {
      id: eventId,
      sourceProvider: "manual_import",
      sourceSystem: "leadcapture_io_legacy",
      sourceType: "manual_entry",
      sourceLeadId: `src-${input.tag}`,
      status: "approved",
      rawPayloadJson: body,
      normalizedPayloadJson: body,
      receivedAt: daysAgo(input.ageDays),
      normalizedAt: daysAgo(input.ageDays),
      approvedAt: daysAgo(1),
    },
  });
  await db.leadInventoryItem.create({
    data: {
      id: itemId,
      inventoryLotId: LOT_ID,
      sourceLeadEventId: eventId,
      generatedAt: daysAgo(input.ageDays),
      normalizedState: input.state,
      nicheKey: "vet",
      sourceProvider: "manual_import",
      sourceLane: "aged_csv_beta",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "available",
      availableAt: new Date(),
      originClientAccountId: input.origin,
    },
  });
  return { itemId, eventId, phone: input.phone, email };
}

async function proveLineCapacity(
  db: PrismaClient,
  state: string,
  firstItemId: string,
  firstEventId: string,
  secondItemId: string,
  secondEventId: string
) {
  const order = await db.leadOrder.create({
    data: {
      orderNumber: await nextLeadOrderNumber(db),
      clientAccountId: BUYER,
      clientDisplayName: BUYER,
      status: "active",
      nicheKey: "vet",
      statesJson: [state],
      leadVolume: 5,
      campaignType: "Aged leads",
      crmPackage: "lead_delivery",
      createdByRole: "admin",
      submittedAt: new Date(),
      activatedAt: new Date(),
      paymentConfirmationStatus: "confirmed",
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 5,
      notes: "mbaccept capacity",
      orderLines: {
        create: {
          lineNumber: 1,
          displayName: "Capacity",
          nicheKey: "vet",
          requestedQuantity: 1,
          unitPriceCents: 300,
          lineTotalCents: 300,
          status: "active",
          normalizedStatesJson: [state],
          ageBandKeysJson: ["COMMERCE_6_9_MO"],
          metadataJson: {
            schema: "ppl_order_line_pricing_v1",
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            commerceAgeBucketKey: "COMMERCE_6_9_MO",
            unitPriceCents: 300,
          },
        },
      },
    },
    include: { orderLines: true },
  });
  const lineId = order.orderLines[0]!.id;
  const firstAllocation = await shadowAllocation(db, order.id, lineId, firstItemId, firstEventId, "cap-a");
  const secondAllocation = await shadowAllocation(db, order.id, lineId, secondItemId, secondEventId, "cap-b");
  const first = await db.$transaction((tx) =>
    reserveLeadAllocationAtomicTx(firstAllocation, `mbaccept-rsv-${firstAllocation}`, tx)
  );
  assert.equal(first.reserved, true);
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        reserveLeadAllocationAtomicTx(secondAllocation, `mbaccept-rsv-${secondAllocation}`, tx)
      ),
    /line_capacity_claim_failed/
  );
  assert.equal(
    (await db.leadInventoryItem.findUniqueOrThrow({ where: { id: secondItemId } })).status,
    "available"
  );
  assert.equal(
    (await db.leadAllocation.findUniqueOrThrow({ where: { id: secondAllocation } })).status,
    "shadow"
  );
}

async function proveInventoryLock(db: PrismaClient, state: string, itemId: string, eventId: string) {
  const orders = [];
  for (const tag of ["lock-a", "lock-b"]) {
    orders.push(
      await db.leadOrder.create({
        data: {
          orderNumber: await nextLeadOrderNumber(db),
          clientAccountId: BUYER,
          clientDisplayName: BUYER,
          status: "active",
          nicheKey: "vet",
          statesJson: [state],
          leadVolume: 1,
          campaignType: "Aged leads",
          crmPackage: "lead_delivery",
          createdByRole: "admin",
          submittedAt: new Date(),
          activatedAt: new Date(),
          paymentConfirmationStatus: "confirmed",
          orderKind: "pay_per_lead",
          fulfillmentMode: "pooled_matching",
          requestedQuantity: 1,
          notes: `mbaccept ${tag}`,
          orderLines: {
            create: {
              lineNumber: 1,
              displayName: tag,
              nicheKey: "vet",
              requestedQuantity: 1,
              unitPriceCents: 300,
              lineTotalCents: 300,
              status: "active",
              normalizedStatesJson: [state],
              ageBandKeysJson: ["COMMERCE_6_9_MO"],
              metadataJson: {
                schema: "ppl_order_line_pricing_v1",
                pricingVersion: "ppl_aged_beta_2026_08_v1",
                commerceAgeBucketKey: "COMMERCE_6_9_MO",
                unitPriceCents: 300,
              },
            },
          },
        },
        include: { orderLines: true },
      })
    );
  }
  const allocations = await Promise.all(
    orders.map((order, index) =>
      shadowAllocation(
        db,
        order.id,
        order.orderLines[0]!.id,
        itemId,
        eventId,
        `lock-${index}`
      )
    )
  );
  const results = await Promise.all(
    allocations.map(async (allocationId) => {
      try {
        return await db.$transaction(
          (tx) => reserveLeadAllocationAtomicTx(allocationId, `mbaccept-rsv-${allocationId}`, tx),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        return { reserved: false as const, message: error instanceof Error ? error.message : "error" };
      }
    })
  );
  const winners = results.filter((result) => result.reserved);
  assert.equal(winners.length, 1);
  assert.equal(
    (await db.leadInventoryItem.findUniqueOrThrow({ where: { id: itemId } })).status,
    "reserved"
  );
}

async function shadowAllocation(
  db: PrismaClient,
  orderId: string,
  lineId: string,
  itemId: string,
  eventId: string,
  tag: string
) {
  const created = await db.leadAllocation.create({
    data: {
      sourceLeadEventId: eventId,
      leadOrderId: orderId,
      leadOrderLineId: lineId,
      clientAccountId: BUYER,
      leadInventoryItemId: itemId,
      status: "shadow",
      allocationPolicyVersion: PPL_ALLOCATION_POLICY_VERSION,
      idempotencyKey: `mbaccept-shadow-${tag}`,
    },
  });
  return created.id;
}

async function cleanup(db: PrismaClient) {
  const orders = await db.leadOrder.findMany({
    where: { clientAccountId: BUYER, notes: { contains: "mbaccept" } },
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
    where: { OR: [{ clientAccountId: BUYER }, { sourceLeadEventId: { startsWith: "mbaccept-evt-" } }] },
  });
  await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: "mbaccept-item-" } } });
  await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: "mbaccept-evt-" } } });
  await db.inventoryLot.deleteMany({ where: { id: LOT_ID } });
}
