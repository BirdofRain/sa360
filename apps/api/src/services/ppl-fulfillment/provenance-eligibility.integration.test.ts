import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  BUYER_EXPORT_UNRESOLVED_PROVENANCE,
  commitBuyerCsvExport,
  markSpreadsheetDelivered,
  previewBuyerCsvExport,
  SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
} from "./buyer-csv-export.service.js";
import {
  commitPplInventorySelection,
  previewPplInventorySelection,
  queryEligibleInventoryCandidatesBounded,
  releasePplAllocation,
} from "./inventory-selection.service.js";
import {
  decideLeadReplacement,
  REPLACEMENT_CONFIRM_APPROVE_PHRASE,
} from "./replacement.service.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

const JR_LABEL = "JR Laird - Trucker - 3/4/26";
const NICHE_UNRESOLVED = "trucker_provenance_unresolved";
const NICHE_RESALE = "trucker_provenance_resale";
const NICHE_PROVIDER = "trucker_provenance_provider";
const STATE = "GA";
const BUYER_JR = "client_provgate_jr";
const BUYER_OTHER = "client_provgate_other";
const ORIGIN_A = "client_provgate_origin_a";
const BUCKETS = ["COMMERCE_3_6_MO"] as const;

const UNRESOLVED_ITEM = "provgate-unresolved-ga";
const RESALE_ITEM = "provgate-resale-ga";
const FACEBOOK_ITEM = "provgate-facebook-ga";
const LEADCAPTURE_ITEM = "provgate-leadcapture-ga";
const RESERVED_ITEM = "provgate-reserved-ga";

describe("fail-closed historical provenance gate", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const orderIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    process.env.SA360_PPL_REPLACEMENT_ENABLED = "true";
    process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
    db = new PrismaClient({ datasources: { db: { url } } });
    await resetProvgate();

    for (const client of [
      { clientAccountId: BUYER_JR, clientDisplayName: "JR Laird" },
      { clientAccountId: BUYER_OTHER, clientDisplayName: "Other Client Buyer" },
      { clientAccountId: ORIGIN_A, clientDisplayName: "Origin Client A" },
    ]) {
      await db.clientAccount.upsert({
        where: { clientAccountId: client.clientAccountId },
        create: {
          clientAccountId: client.clientAccountId,
          clientDisplayName: client.clientDisplayName,
          status: "active",
          portalEnabled: false,
          primaryNicheKeys: ["trucker"],
        },
        update: { clientDisplayName: client.clientDisplayName, status: "active" },
      });
    }

    const generatedAt = new Date(Date.now() - 120 * 86400000);
    const lot = await db.inventoryLot.upsert({
      where: { lotKey: "provgate-lot" },
      create: {
        lotKey: "provgate-lot",
        displayName: "Provenance gate lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_inventory_bulk_csv",
        nicheKey: "trucker",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: "supplier_provgate",
        status: "active",
        activatedAt: new Date(),
      },
      update: { status: "active", supplierAccountId: "supplier_provgate" },
    });

    await seedInventory({
      itemId: UNRESOLVED_ITEM,
      eventId: "provgate-evt-unresolved",
      nicheKey: NICHE_UNRESOLVED,
      provider: "manual_import",
      sourceSystem: "csv_import",
      originClientAccountId: null,
      status: "available",
      campaignName: JR_LABEL,
      exclusivityMode: "exclusive",
      metadataJson: { usedBy: "JR Laird", usedByPresent: true },
      phone: "+14045550131",
      lotId: lot.id,
      generatedAt,
    });
    await seedInventory({
      itemId: RESALE_ITEM,
      eventId: "provgate-evt-resale",
      nicheKey: NICHE_RESALE,
      provider: "manual_import",
      sourceSystem: "csv_import",
      originClientAccountId: ORIGIN_A,
      status: "available",
      campaignName: "Other Client - Trucker",
      exclusivityMode: "exclusive",
      metadataJson: {},
      phone: "+14045550132",
      lotId: lot.id,
      generatedAt,
    });
    await seedInventory({
      itemId: FACEBOOK_ITEM,
      eventId: "provgate-evt-facebook",
      nicheKey: NICHE_PROVIDER,
      provider: "facebook",
      sourceSystem: "meta_lead_ads",
      originClientAccountId: null,
      status: "available",
      campaignName: null,
      exclusivityMode: "configurable",
      metadataJson: {},
      phone: "+14045550133",
      lotId: lot.id,
      generatedAt,
    });
    await seedInventory({
      itemId: LEADCAPTURE_ITEM,
      eventId: "provgate-evt-leadcapture",
      nicheKey: NICHE_PROVIDER,
      provider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      originClientAccountId: null,
      status: "available",
      campaignName: null,
      exclusivityMode: "configurable",
      metadataJson: {},
      phone: "+14045550134",
      lotId: lot.id,
      generatedAt: new Date(generatedAt.getTime() + 1000),
    });
    await seedInventory({
      itemId: RESERVED_ITEM,
      eventId: "provgate-evt-reserved",
      nicheKey: "trucker",
      provider: "manual_import",
      sourceSystem: "csv_import",
      originClientAccountId: null,
      status: "reserved",
      campaignName: JR_LABEL,
      exclusivityMode: "exclusive",
      metadataJson: { usedBy: "JR Laird" },
      phone: "+14045550135",
      lotId: lot.id,
      generatedAt,
    });

    const reservedOrder = await createOrder(BUYER_JR, "trucker", "PROVGATE-RESERVED");
    await db.leadAllocation.deleteMany({ where: { leadInventoryItemId: RESERVED_ITEM } });
    await db.leadAllocation.create({
      data: {
        id: "provgate-reserved-alloc",
        sourceLeadEventId: "provgate-evt-reserved",
        leadOrderId: reservedOrder.id,
        leadInventoryItemId: RESERVED_ITEM,
        clientAccountId: BUYER_JR,
        status: "reserved",
        allocationPolicyVersion: "ppl-provenance-eligibility-v1",
        decisionReasonsJson: ["historical_reserved_unresolved"],
        idempotencyKey: "provgate-reserved-alloc",
        proposedAt: new Date(),
        reservedAt: new Date(),
      },
    });
    await db.leadReplacementRequest.deleteMany({
      where: { originalAllocationId: "provgate-reserved-alloc" },
    });
    await db.leadReplacementRequest.create({
      data: {
        id: "provgate-replacement",
        clientAccountId: BUYER_JR,
        leadOrderId: reservedOrder.id,
        originalAllocationId: "provgate-reserved-alloc",
        originalInventoryItemId: RESERVED_ITEM,
        status: "requested",
        reason: "historical unresolved origin",
        reasonCode: "duplicate",
        requestId: "provgate-replacement-request",
      },
    });
    await db.leadDeliveryExportPackage.deleteMany({
      where: { idempotencyKey: "provgate-existing-package" },
    });
    await db.leadDeliveryExportPackage.create({
      data: {
        id: "provgate-existing-package",
        leadOrderId: reservedOrder.id,
        clientAccountId: BUYER_JR,
        format: "csv_v1",
        rowCount: 1,
        contentSha256: "provgate-sha",
        idempotencyKey: "provgate-existing-package",
        fieldSchemaVersion: "buyer_csv_v4",
        allocationIdsJson: ["provgate-reserved-alloc"],
        csvContent: "Age\n62\n",
        metadataJson: { niche: "trucker" },
      },
    });
  });

  after(async () => {
    if (!db) return;
    await resetProvgate();
    await db.$disconnect();
  });

  async function resetProvgate() {
    const orders = await db.leadOrder.findMany({
      where: { id: { startsWith: "provgate-order-" } },
      select: { id: true },
    });
    const knownOrderIds = orders.map((order) => order.id);
    await db.leadReplacementRequest.deleteMany({
      where: {
        OR: [
          { id: "provgate-replacement" },
          { requestId: { startsWith: "provgate-" } },
          ...(knownOrderIds.length > 0 ? [{ leadOrderId: { in: knownOrderIds } }] : []),
        ],
      },
    });
    await db.leadDeliveryExportPackage.deleteMany({
      where: {
        OR: [
          { id: "provgate-existing-package" },
          { idempotencyKey: { startsWith: "provgate-" } },
          ...(knownOrderIds.length > 0 ? [{ leadOrderId: { in: knownOrderIds } }] : []),
        ],
      },
    });
    await db.leadAllocation.deleteMany({
      where: {
        OR: [
          { id: "provgate-reserved-alloc" },
          { idempotencyKey: { startsWith: "provgate-" } },
          { leadInventoryItemId: { in: itemIds() } },
          ...(knownOrderIds.length > 0 ? [{ leadOrderId: { in: knownOrderIds } }] : []),
        ],
      },
    });
    if (knownOrderIds.length > 0) {
      await db.leadOrder.deleteMany({ where: { id: { in: knownOrderIds } } });
    }
    await db.leadInventoryItem.deleteMany({ where: { id: { in: itemIds() } } });
    await db.sourceLeadEvent.deleteMany({
      where: { id: { startsWith: "provgate-evt-" } },
    });
    await db.inventoryLot.deleteMany({ where: { lotKey: "provgate-lot" } });
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [BUYER_JR, BUYER_OTHER, ORIGIN_A] } },
    });
  }

  it("rejects an unresolved manual import for every buyer, including a JR-labeled lead and a JR buyer", async () => {
    const before = await snapshot();
    const jr = await scan(NICHE_UNRESOLVED, BUYER_JR);
    const other = await scan(NICHE_UNRESOLVED, BUYER_OTHER);
    assert.deepEqual(
      jr.candidates.map((row) => row.item.id),
      []
    );
    assert.deepEqual(
      other.candidates.map((row) => row.item.id),
      []
    );
    assert.equal(jr.exclusionCounts.unresolvedProvenance, 1);
    assert.equal(other.exclusionCounts.unresolvedProvenance, 1);
    assert.equal(jr.exclusionCounts.originClient, 0);

    const order = await createOrder(BUYER_JR, NICHE_UNRESOLVED, "PROVGATE-JR");
    const preview = await previewPplInventorySelection(
      { orderId: order.id, commerceAgeBucketKeys: [...BUCKETS], requestedQuantity: 1 },
      db
    );
    assert.equal(preview.ok, false);
    if (!preview.ok) {
      assert.equal(preview.code, "no_inventory");
      assert.equal(preview.exclusionCounts?.unresolvedProvenance, 1);
    }
    const commit = await commitPplInventorySelection(
      {
        orderId: order.id,
        commerceAgeBucketKeys: [...BUCKETS],
        requestedQuantity: 1,
        idempotencyKey: `provgate-commit-${order.id}`,
      },
      db
    );
    assert.equal(commit.ok, false);
    if (!commit.ok) assert.equal(commit.code, "no_inventory");

    const item = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: UNRESOLVED_ITEM } });
    assert.equal(item.status, "available");
    assert.equal(item.originClientAccountId, null);
    const after = await snapshot();
    assert.equal(after.items, before.items);
    assert.equal(after.events, before.events);
    assert.equal(after.allocations, before.allocations);
  });

  it("follows approved resale for a confirmed other-client origin and still blocks that origin buyer", async () => {
    const other = await scan(NICHE_RESALE, BUYER_OTHER);
    const origin = await scan(NICHE_RESALE, ORIGIN_A);
    assert.deepEqual(
      other.candidates.map((row) => row.item.id),
      [RESALE_ITEM]
    );
    assert.equal(other.exclusionCounts.originClient, 0);
    assert.equal(other.exclusionCounts.unresolvedProvenance, 0);
    assert.deepEqual(
      origin.candidates.map((row) => row.item.id),
      []
    );
    assert.equal(origin.exclusionCounts.originClient, 1);
    assert.equal(origin.exclusionCounts.unresolvedProvenance, 0);
  });

  it("rejects null-origin non-LeadCapture inventory and keeps null-origin LeadCapture selectable", async () => {
    const selected = await scan(NICHE_PROVIDER, BUYER_OTHER);
    assert.deepEqual(
      selected.candidates.map((row) => row.item.id),
      [LEADCAPTURE_ITEM]
    );
    assert.equal(selected.exclusionCounts.unresolvedProvenance, 1);
    const facebook = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: FACEBOOK_ITEM } });
    assert.equal(facebook.originClientAccountId, null);
    assert.equal(facebook.status, "available");
  });

  it("does not newly export, deliver, release, or replace previously reserved unresolved inventory", async () => {
    const before = await snapshot();
    const order = orderIds.find((id) => id.startsWith("provgate-order-PROVGATE-RESERVED"));
    assert.ok(order);

    const preview = await previewBuyerCsvExport({ orderId: order }, db);
    assert.equal(preview.ok, false);
    if (!preview.ok) assert.equal(preview.code, BUYER_EXPORT_UNRESOLVED_PROVENANCE);

    const commit = await commitBuyerCsvExport(
      { orderId: order, idempotencyKey: "provgate-new-export" },
      db
    );
    assert.equal(commit.ok, false);
    if (!commit.ok) assert.equal(commit.code, BUYER_EXPORT_UNRESOLVED_PROVENANCE);
    assert.equal(
      await db.leadDeliveryExportPackage.count({
        where: { idempotencyKey: "provgate-new-export" },
      }),
      0
    );

    const delivered = await markSpreadsheetDelivered(
      {
        exportId: "provgate-existing-package",
        confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
        idempotencyKey: "provgate-mark-delivered",
      },
      db
    );
    assert.equal(delivered.ok, false);
    if (!delivered.ok) assert.equal(delivered.code, BUYER_EXPORT_UNRESOLVED_PROVENANCE);

    await db.leadReplacementRequest.deleteMany({ where: { id: "provgate-replacement" } });
    const release = await releasePplAllocation(
      { allocationId: "provgate-reserved-alloc", reason: "operator_release" },
      db
    );
    assert.equal(release.ok, false);
    if (!release.ok) assert.equal(release.code, "unresolved_provenance");

    await db.leadReplacementRequest.create({
      data: {
        id: "provgate-replacement",
        clientAccountId: BUYER_JR,
        leadOrderId: order,
        originalAllocationId: "provgate-reserved-alloc",
        originalInventoryItemId: RESERVED_ITEM,
        status: "requested",
        reason: "historical unresolved origin",
        reasonCode: "duplicate",
        requestId: "provgate-replacement-request",
      },
    });
    const replacement = await decideLeadReplacement(
      {
        replacementId: "provgate-replacement",
        action: "approve",
        confirmationPhrase: REPLACEMENT_CONFIRM_APPROVE_PHRASE,
        requestId: "provgate-replacement-decide",
      },
      db
    );
    assert.equal(replacement.ok, false);
    if (!replacement.ok) assert.equal(replacement.code, "unresolved_provenance");

    const item = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: RESERVED_ITEM } });
    assert.equal(item.status, "reserved");
    const allocation = await db.leadAllocation.findUniqueOrThrow({
      where: { id: "provgate-reserved-alloc" },
    });
    assert.equal(allocation.status, "reserved");
    const request = await db.leadReplacementRequest.findUniqueOrThrow({
      where: { id: "provgate-replacement" },
    });
    assert.equal(request.status, "requested");
    assert.equal(request.replacementAllocationId, null);
    const pkg = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: "provgate-existing-package" },
    });
    assert.equal(pkg.spreadsheetDeliveredAt, null);

    const after = await snapshot();
    assert.equal(after.items, before.items);
    assert.equal(after.events, before.events);
    assert.equal(after.allocations, before.allocations);
  });

  function itemIds(): string[] {
    return [UNRESOLVED_ITEM, RESALE_ITEM, FACEBOOK_ITEM, LEADCAPTURE_ITEM, RESERVED_ITEM];
  }

  async function snapshot() {
    const [items, events, allocations] = await Promise.all([
      db.leadInventoryItem.count(),
      db.sourceLeadEvent.count(),
      db.leadAllocation.count(),
    ]);
    return { items, events, allocations };
  }

  async function scan(nicheKey: string, clientAccountId: string) {
    return queryEligibleInventoryCandidatesBounded(
      {
        nicheKey,
        states: [STATE],
        commerceAgeBucketKeys: [...BUCKETS],
        clientAccountId,
        exclusions: [],
        evaluatedAt: new Date(),
        targetEligible: 10,
      },
      db
    );
  }

  async function createOrder(clientAccountId: string, nicheKey: string, label: string) {
    const order = await db.leadOrder.create({
      data: {
        id: `provgate-order-${label}`,
        orderNumber: `${label}-${Date.now()}`,
        clientAccountId,
        clientDisplayName: clientAccountId,
        status: "active",
        nicheKey,
        statesJson: [STATE],
        leadVolume: 1,
        deliveryCadence: "test",
        campaignType: "provenance_gate",
        crmPackage: "simulation_only",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 1,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function seedInventory(input: {
    itemId: string;
    eventId: string;
    nicheKey: string;
    provider: "manual_import" | "facebook" | "leadcapture_io";
    sourceSystem: "csv_import" | "meta_lead_ads" | "leadcapture_io_nextgen";
    originClientAccountId: string | null;
    status: "available" | "reserved";
    campaignName: string | null;
    exclusivityMode: "exclusive" | "configurable";
    metadataJson: Record<string, unknown>;
    phone: string;
    lotId: string;
    generatedAt: Date;
  }) {
    const payload = {
      contact: {
        first_name: "Gale",
        last_name: "Hauler",
        phone_e164: input.phone,
        email: `${input.itemId}@example.test`,
        state: STATE,
      },
      lead_details: { consumer_age: 62 },
    };
    await db.leadAllocation.deleteMany({ where: { leadInventoryItemId: input.itemId } });
    await db.leadInventoryItem.deleteMany({ where: { id: input.itemId } });
    await db.sourceLeadEvent.deleteMany({ where: { id: input.eventId } });
    await db.sourceLeadEvent.create({
      data: {
        id: input.eventId,
        sourceProvider: input.provider,
        sourceSystem: input.sourceSystem,
        sourceType: input.provider === "manual_import" ? "bulk_import" : "webhook",
        sourceLeadId: input.itemId,
        sourceCampaignName: input.campaignName,
        status: "approved",
        rawPayloadJson: {
          importRequestId: "aged-bulk-trucker-provgate",
          rowNumber: 1,
          master: { lead_type: input.campaignName },
        },
        normalizedPayloadJson: {
          ...payload,
          campaign_name: input.campaignName,
        },
        receivedAt: input.generatedAt,
        normalizedAt: input.generatedAt,
        approvedAt: new Date(),
      },
    });
    await db.leadInventoryItem.create({
      data: {
        id: input.itemId,
        inventoryLotId: input.lotId,
        sourceLeadEventId: input.eventId,
        generatedAt: input.generatedAt,
        normalizedState: STATE,
        nicheKey: input.nicheKey,
        sourceProvider: input.provider,
        sourceLane: "aged_inventory_bulk_csv",
        inventoryClass: "aged",
        exclusivityMode: input.exclusivityMode,
        status: input.status,
        availableAt: input.status === "available" ? new Date() : null,
        reservedAt: input.status === "reserved" ? new Date() : null,
        originClientAccountId: input.originClientAccountId,
        metadataJson: input.metadataJson as Prisma.InputJsonValue,
      },
    });
  }
});
