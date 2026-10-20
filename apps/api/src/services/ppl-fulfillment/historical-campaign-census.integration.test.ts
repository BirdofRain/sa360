/**
 * Local Postgres proof for the historical campaign census.
 * Uses SA360_TEST_DATABASE_URL only (localhost, database name contains "test").
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { buildApp } from "../../app.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { withProvenanceAuditSnapshot } from "./provenance-impact-audit.js";
import {
  runHistoricalCampaignCensus,
  runHistoricalOrderDrilldown,
  type HistoricalCensusReport,
} from "./historical-campaign-census.js";

const integrationUrl =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrl);

const PREFIX = "hcc00bf";
const BUYER = `${PREFIX}_buyer`;
const ORIGIN = `${PREFIX}_origin`;
const VET = `${PREFIX}_vet`;
const TRUCKER = `${PREFIX}_trucker`;
const VET_LOT = `${PREFIX}-vet`;
const TRUCKER_LOT = `${PREFIX}-trucker`;
const VET_IMPORT = "aged-bulk-vet-hcc";
const TRUCKER_IMPORT = "aged-bulk-trucker-hcc";
const ORDER_NUMBER = "HCC00BF-LO1053";
const BUYER_NAME = "HCC Secret Buyer Name";
const ORIGIN_NAME = "HCC Secret Origin Name";
const VET_LABEL = "HCC Secret Vet Label";
const TRUCKER_LABEL = "HCC Secret Trucker";
const OWNED_LABEL = "HCC Secret Owned";
const BUYER_LABEL = "HCC Secret Buyer Origin";
const LATER_LABEL = "HCC Later Workbook";
const CONFLICT_LABEL = "HCC Other Trucker";
const CSV_SECRET = "hcc-secret@example.test";
const REPLACEMENT_SECRET = "HCC secret replacement +15555550123";
const TARGET_SECRET = "HCC Secret Target Name";
const PHONE = "+15555550124";

const SECRETS = [
  BUYER_NAME,
  ORIGIN_NAME,
  VET_LABEL,
  TRUCKER_LABEL,
  OWNED_LABEL,
  BUYER_LABEL,
  LATER_LABEL,
  CONFLICT_LABEL,
  CSV_SECRET,
  REPLACEMENT_SECRET,
  TARGET_SECRET,
  PHONE,
];

function mustCensus(result: Awaited<ReturnType<typeof runHistoricalCampaignCensus>>): HistoricalCensusReport {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected census");
  return result;
}

describe("historical campaign census postgres proof", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrl);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup(db);
  });

  after(async () => {
    if (db) {
      await cleanup(db);
      await db.$disconnect();
    }
  });

  it("counts historical rows without labels, stamps nothing, and classifies LO-style reservations", async () => {
    const before = mustCensus(await runHistoricalCampaignCensus(db));
    const beforeItems = await db.leadInventoryItem.count();
    await seed(db);
    const after = mustCensus(await runHistoricalCampaignCensus(db));
    assert.equal(after.population.inventoryRows - before.population.inventoryRows, 7);
    assert.equal(after.population.distinctOriginalLabels - before.population.distinctOriginalLabels, 4);
    assert.equal(after.population.unresolvedOriginRows - before.population.unresolvedOriginRows, 5);
    assert.equal(after.population.stampedOriginRows - before.population.stampedOriginRows, 2);
    assert.equal(after.population.consistentOriginalLabelRows - before.population.consistentOriginalLabelRows, 4);
    assert.equal(after.population.missingAttributionRows - before.population.missingAttributionRows, 2);
    assert.equal(after.population.conflictingAttributionRows - before.population.conflictingAttributionRows, 1);
    assert.equal(after.labelPopulations.oneRow - before.labelPopulations.oneRow, 3);
    assert.equal(after.labelPopulations.twoToTenRows - before.labelPopulations.twoToTenRows, 1);
    assert.equal(after.ownershipStampApplied, false);
    assert.equal(after.resaleAuthorizationApplied, false);
    assert.equal(after.clientNameMatchUsed, false);
    assert.equal(after.julySourceCampaignNamePreserved, true);
    assert.equal(after.labelTextOmitted, true);
    assert.equal(after.measurement.operatorVerifiedProduction, false);

    const nicheRows = (report: HistoricalCensusReport, niche: string) =>
      report.byNiche.find((row) => row.nicheKey === niche)?.inventoryRows ?? 0;
    const importRows = (report: HistoricalCensusReport, importRequest: string) =>
      report.byImportRequest.find((row) => row.importRequest === importRequest)?.inventoryRows ?? 0;
    const agreementRows = (report: HistoricalCensusReport, agreement: string) =>
      report.byAgreement.find((row) => row.agreement === agreement)?.inventoryRows ?? 0;
    const statusRows = (report: HistoricalCensusReport, status: string) =>
      report.byInventoryStatus.find((row) => row.status === status)?.inventoryRows ?? 0;
    const stampedRows = (report: HistoricalCensusReport, clientId: string) =>
      report.stampedOriginClients.find((row) => row.originClientAccountId === clientId)?.inventoryRows ?? 0;
    assert.equal(nicheRows(after, VET) - nicheRows(before, VET), 5);
    assert.equal(nicheRows(after, TRUCKER) - nicheRows(before, TRUCKER), 2);
    assert.equal(importRows(after, VET_IMPORT) - importRows(before, VET_IMPORT), 5);
    assert.equal(importRows(after, TRUCKER_IMPORT) - importRows(before, TRUCKER_IMPORT), 2);
    assert.equal(agreementRows(after, "july_column_agrees") - agreementRows(before, "july_column_agrees"), 4);
    assert.equal(agreementRows(after, "july_column_conflicts") - agreementRows(before, "july_column_conflicts"), 1);
    assert.equal(agreementRows(after, "all_missing") - agreementRows(before, "all_missing"), 1);
    assert.equal(
      agreementRows(after, "post_july_label_without_column") - agreementRows(before, "post_july_label_without_column"),
      1
    );
    assert.equal(statusRows(after, "available") - statusRows(before, "available"), 5);
    assert.equal(statusRows(after, "reserved") - statusRows(before, "reserved"), 2);
    // The LeadCapture allocation stays on the order and outside this historical census.
    assert.equal(after.openAllocations.rows - before.openAllocations.rows, 4);
    assert.equal(stampedRows(after, ORIGIN) - stampedRows(before, ORIGIN), 1);
    assert.equal(stampedRows(after, BUYER) - stampedRows(before, BUYER), 1);

    const serialized = JSON.stringify(after);
    for (const secret of SECRETS) assert.equal(serialized.includes(secret), false, secret);
    assert.equal(await db.leadInventoryItem.count(), beforeItems + 8);

    const order = await runHistoricalOrderDrilldown(db, ORDER_NUMBER);
    assert.equal(order.ok, true);
    if (!order.ok) return;
    assert.equal(order.orderNumber, ORDER_NUMBER);
    assert.equal(order.buyerClientAccountId, BUYER);
    assert.equal(order.resaleAuthorizationPersisted, false);
    assert.equal(order.allocations.rows, 5);
    assert.equal(order.allocations.reservedRows, 4);
    assert.equal(order.allocations.originEqualsBuyerRows, 1);
    assert.equal(order.allocations.originOtherClientRows, 1);
    assert.equal(order.reservedRevisedPolicy.wouldBlockUnresolvedOrigin, 1);
    assert.equal(order.reservedRevisedPolicy.wouldBlockSameOrigin, 1);
    assert.equal(order.reservedRevisedPolicy.wouldBlockUntilResaleAuthorization, 1);
    assert.equal(order.reservedRevisedPolicy.outsideHistoricalGate, 1);
    assert.equal(order.delivery.packages, 1);
    assert.equal(order.delivery.spreadsheetDeliveredPackages, 1);
    assert.equal(order.delivery.instructionsByStatus.find((row) => row.status === "planned")?.instructions, 1);
    assert.equal(order.replacementsByStatus.find((row) => row.status === "requested")?.requests, 1);
    assert.equal(order.allocations.byStatus.find((row) => row.status === "shadow")?.allocations, 1);
    const orderText = JSON.stringify(order);
    for (const secret of SECRETS) assert.equal(orderText.includes(secret), false, secret);
    assert.equal(orderText.includes("csvContent"), false);

    const missing = await runHistoricalOrderDrilldown(db, "HCC00BF-MISSING");
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.code, "historical_order_not_found");
    assert.equal(JSON.stringify(missing).includes("reservedRows"), false);
    assert.equal(await db.leadInventoryItem.count(), beforeItems + 8);
  });

  it("refuses a second census while one snapshot is open and rejects writes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened = false;
    const first = runHistoricalCampaignCensus(db, {
      afterSnapshotOpened: async () => {
        opened = true;
        await gate;
      },
    });
    while (!opened) await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await runHistoricalCampaignCensus(db);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "census_already_running");
    release();
    const finished = await first;
    assert.equal(finished.ok, true);

    const itemId = `${PREFIX}-a`;
    const statusBefore = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    await assert.rejects(() =>
      withProvenanceAuditSnapshot(db, async (tx) => {
        await tx.$executeRaw`
          UPDATE "LeadInventoryItem"
          SET "nicheKey" = 'mutated'
          WHERE id = ${itemId}
        `;
      })
    );
    const statusAfter = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(statusAfter.nicheKey, statusBefore.nicheKey);
    assert.equal(statusAfter.originClientAccountId, statusBefore.originClientAccountId);
  });

  it("serves the admin route and still rejects the audit credential", async () => {
    const app = await buildApp();
    const previousFlag = process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED;
    const previousAdmin = process.env.ADMIN_API_KEY;
    const previousAudit = process.env.SA360_AUDIT_READONLY_KEY;
    process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED = "true";
    process.env.ADMIN_API_KEY = "hcc-admin-key-012345";
    process.env.SA360_AUDIT_READONLY_KEY = "hcc-audit-key-012345";
    try {
      const denied = await app.inject({
        method: "GET",
        url: `/admin/v1/fulfillment-ops/historical-campaign-orders/${ORDER_NUMBER}`,
        headers: { "x-sa360-provenance-audit-key": "hcc-audit-key-012345" },
      });
      assert.equal(denied.statusCode, 401);

      const allowed = await app.inject({
        method: "GET",
        url: `/admin/v1/fulfillment-ops/historical-campaign-orders/${ORDER_NUMBER}`,
        headers: { "x-sa360-admin-key": "hcc-admin-key-012345" },
      });
      assert.equal(allowed.statusCode, 200);
      assert.equal(allowed.json().buyerClientAccountId, BUYER);
      assert.equal(JSON.stringify(allowed.json()).includes(VET_LABEL), false);
      assert.equal(await db.leadInventoryItem.count({ where: { id: { startsWith: PREFIX } } }), 8);
    } finally {
      if (previousFlag === undefined) delete process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED;
      else process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED = previousFlag;
      if (previousAdmin === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousAdmin;
      if (previousAudit === undefined) delete process.env.SA360_AUDIT_READONLY_KEY;
      else process.env.SA360_AUDIT_READONLY_KEY = previousAudit;
      await app.close();
    }
  });
});

async function cleanup(db: PrismaClient) {
  await db.deliveryInstruction.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.deliveryTarget.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadReplacementRequest.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadDeliveryExportPackage.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadAllocation.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadOrder.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.inventoryLot.deleteMany({ where: { lotKey: { startsWith: PREFIX } } });
  await db.clientAccount.deleteMany({
    where: { clientAccountId: { in: [BUYER, ORIGIN] } },
  });
}

async function seed(db: PrismaClient) {
  await cleanup(db);
  await db.clientAccount.create({
    data: {
      clientAccountId: BUYER,
      clientDisplayName: BUYER_NAME,
      status: "active",
      portalEnabled: false,
      primaryNicheKeys: [],
    },
  });
  await db.clientAccount.create({
    data: {
      clientAccountId: ORIGIN,
      clientDisplayName: ORIGIN_NAME,
      status: "active",
      portalEnabled: false,
      primaryNicheKeys: [],
    },
  });
  await db.inventoryLot.create({
    data: {
      lotKey: VET_LOT,
      displayName: "HCC vet lot",
      sourceProvider: "manual_import",
      sourceLane: PREFIX,
      nicheKey: VET,
      inventoryClass: "aged",
      status: "active",
    },
  });
  await db.inventoryLot.create({
    data: {
      lotKey: TRUCKER_LOT,
      displayName: "HCC trucker lot",
      sourceProvider: "manual_import",
      sourceLane: PREFIX,
      nicheKey: TRUCKER,
      inventoryClass: "aged",
      status: "active",
    },
  });

  await insertItem(db, {
    id: `${PREFIX}-a`,
    niche: VET,
    lotKey: VET_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "available",
    campaign: VET_LABEL,
    normalized: VET_LABEL,
    importRequest: VET_IMPORT,
  });
  await insertItem(db, {
    id: `${PREFIX}-b`,
    niche: VET,
    lotKey: VET_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "available",
    campaign: VET_LABEL,
    normalized: VET_LABEL,
    importRequest: VET_IMPORT,
  });
  await insertItem(db, {
    id: `${PREFIX}-c`,
    niche: TRUCKER,
    lotKey: TRUCKER_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "reserved",
    campaign: TRUCKER_LABEL,
    normalized: CONFLICT_LABEL,
    importRequest: TRUCKER_IMPORT,
  });
  await insertItem(db, {
    id: `${PREFIX}-d`,
    niche: TRUCKER,
    lotKey: TRUCKER_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "available",
    origin: ORIGIN,
    campaign: OWNED_LABEL,
    normalized: OWNED_LABEL,
    importRequest: TRUCKER_IMPORT,
  });
  await insertItem(db, {
    id: `${PREFIX}-e`,
    niche: VET,
    lotKey: VET_LOT,
    provider: "leadcapture_io",
    system: "leadcapture_io_nextgen",
    sourceType: "webhook",
    status: "available",
  });
  await insertItem(db, {
    id: `${PREFIX}-f`,
    niche: VET,
    lotKey: VET_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "available",
    importRequest: VET_IMPORT,
  });
  await insertItem(db, {
    id: `${PREFIX}-g`,
    niche: VET,
    lotKey: VET_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "available",
    normalized: LATER_LABEL,
    importRequest: VET_IMPORT,
  });
  await insertItem(db, {
    id: `${PREFIX}-h`,
    niche: VET,
    lotKey: VET_LOT,
    provider: "manual_import",
    system: "csv_import",
    status: "reserved",
    origin: BUYER,
    campaign: BUYER_LABEL,
    normalized: BUYER_LABEL,
    importRequest: VET_IMPORT,
  });

  await db.leadOrder.create({
    data: {
      id: `${PREFIX}-order`,
      orderNumber: ORDER_NUMBER,
      clientAccountId: BUYER,
      clientDisplayName: BUYER_NAME,
      status: "active",
      nicheKey: VET,
      statesJson: ["GA"],
      leadVolume: 4,
      campaignType: "historical-census",
      crmPackage: "simulation_only",
      createdByRole: "admin",
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 4,
    },
  });

  const allocations = [
    ["a", "shadow"],
    ["c", "reserved"],
    ["d", "reserved"],
    ["e", "reserved"],
    ["h", "reserved"],
  ] as const;
  for (const [suffix, status] of allocations) {
    await db.leadAllocation.create({
      data: {
        id: `${PREFIX}-alloc-${suffix}`,
        sourceLeadEventId: `${PREFIX}-evt-${suffix}`,
        leadOrderId: `${PREFIX}-order`,
        leadInventoryItemId: `${PREFIX}-${suffix}`,
        clientAccountId: BUYER,
        status,
        allocationPolicyVersion: "historical-census",
        idempotencyKey: `${PREFIX}-alloc-${suffix}`,
      },
    });
  }

  await db.deliveryTarget.create({
    data: {
      id: `${PREFIX}-target`,
      clientAccountId: BUYER,
      displayName: TARGET_SECRET,
      adapterKey: "test.simulated.v1",
    },
  });
  await db.deliveryInstruction.create({
    data: {
      id: `${PREFIX}-instruction`,
      leadAllocationId: `${PREFIX}-alloc-c`,
      deliveryTargetId: `${PREFIX}-target`,
      sequence: 1,
      status: "planned",
    },
  });
  await db.leadDeliveryExportPackage.create({
    data: {
      id: `${PREFIX}-package`,
      leadOrderId: `${PREFIX}-order`,
      clientAccountId: BUYER,
      rowCount: 1,
      contentSha256: "hcc00bf-sha",
      idempotencyKey: `${PREFIX}-package`,
      fieldSchemaVersion: "census-test",
      csvContent: `phone,email\n${PHONE},${CSV_SECRET}\n`,
      spreadsheetDeliveredAt: new Date("2026-08-01T00:00:00.000Z"),
      customerReleaseNotifyStatus: "sent",
    },
  });
  await db.leadReplacementRequest.create({
    data: {
      id: `${PREFIX}-replacement`,
      clientAccountId: BUYER,
      leadOrderId: `${PREFIX}-order`,
      originalAllocationId: `${PREFIX}-alloc-c`,
      originalInventoryItemId: `${PREFIX}-c`,
      status: "requested",
      reason: REPLACEMENT_SECRET,
      requestId: `${PREFIX}-replacement-request`,
    },
  });
}

async function insertItem(
  db: PrismaClient,
  input: {
    id: string;
    niche: string;
    lotKey: string;
    provider: "manual_import" | "leadcapture_io";
    system: "csv_import" | "leadcapture_io_nextgen";
    sourceType?: "bulk_import" | "webhook";
    status: "available" | "reserved";
    origin?: string;
    campaign?: string;
    normalized?: string;
    importRequest?: string;
  }
) {
  const suffix = input.id.slice(PREFIX.length + 1);
  const lot = await db.inventoryLot.findUniqueOrThrow({ where: { lotKey: input.lotKey } });
  const raw: Record<string, unknown> = {};
  if (input.importRequest) raw.importRequestId = input.importRequest;
  const normalized: Record<string, unknown> = { marker: PREFIX };
  if (input.normalized) normalized.campaign_name = input.normalized;
  await db.sourceLeadEvent.create({
    data: {
      id: `${PREFIX}-evt-${suffix}`,
      sourceProvider: input.provider,
      sourceSystem: input.system,
      sourceType: input.sourceType ?? "bulk_import",
      sourceCampaignName: input.campaign ?? null,
      status: "approved",
      rawPayloadJson: raw as Prisma.InputJsonValue,
      normalizedPayloadJson: normalized as Prisma.InputJsonValue,
    },
  });
  await db.leadInventoryItem.create({
    data: {
      id: input.id,
      inventoryLotId: lot.id,
      sourceLeadEventId: `${PREFIX}-evt-${suffix}`,
      generatedAt: new Date("2026-01-15T00:00:00.000Z"),
      normalizedState: "GA",
      nicheKey: input.niche,
      sourceProvider: input.provider,
      sourceLane: PREFIX,
      inventoryClass: "aged",
      status: input.status,
      availableAt: input.status === "available" ? new Date("2026-02-01T00:00:00.000Z") : null,
      reservedAt: input.status === "reserved" ? new Date("2026-03-01T00:00:00.000Z") : null,
      originClientAccountId: input.origin ?? null,
      phoneFingerprint: "hcc-phone-fingerprint",
      emailFingerprint: "hcc-email-fingerprint",
    },
  });
}
