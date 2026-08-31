/**
 * Postgres-backed generate → release → customer download for buyer_csv_v4.
 * Does not mutate already-released historical packages.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  findReleasedLeadDeliveryExportPackageForClient,
} from "../../repositories/lead-delivery-export-package.repository.js";
import { getClientReleasedDeliveryDownload } from "../lead-order/lead-order-released-deliveries.service.js";
import {
  BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V4_FIELD_SCHEMA_VERSION,
  commitBuyerCsvExport,
  getBuyerCsvExportDownload,
  markSpreadsheetDelivered,
  previewBuyerCsvExport,
  serializeBuyerCsvV3,
} from "./buyer-csv-export.service.js";
import { commitPplInventorySelection } from "./inventory-selection.service.js";
import { seedPplAgedBetaFixtures } from "./ppl-beta-fixtures.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

describe("buyer_csv_v4 generate/release/download", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
  });

  after(async () => {
    await db?.$disconnect();
  });

  it("writes customer-facing CSV, keeps generated unpublished, and leaves historical v3 readable", async () => {
    const fixtures = await seedPplAgedBetaFixtures(db);
    const selected = await commitPplInventorySelection(
      {
        orderId: fixtures.orderId,
        requestedQuantity: 3,
        commerceAgeBucketKeys: [
          "COMMERCE_1_3_MO",
          "COMMERCE_3_6_MO",
          "COMMERCE_6_9_MO",
          "COMMERCE_12_MO_PLUS",
        ],
        idempotencyKey: `v4-select-${fixtures.orderId}`,
      },
      db
    );
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    const selectedAllocationIds = selected.allocationIds ?? [];
    assert.equal(selectedAllocationIds.length, 3);

    const preview = await previewBuyerCsvExport({ orderId: fixtures.orderId }, db);
    assert.equal(preview.ok, true);
    if (!preview.ok || !("columns" in preview)) return;
    assert.equal(preview.fieldSchemaVersion, BUYER_CSV_V4_FIELD_SCHEMA_VERSION);
    assert.equal(preview.columns[0], "Date Generated");
    assert.equal(preview.columns[1], "Lead Type");
    assert.equal(preview.rowCount, selectedAllocationIds.length);
    assert.equal(preview.rowCount, 3);

    const committed = await commitBuyerCsvExport(
      { orderId: fixtures.orderId, idempotencyKey: `v4-export-${fixtures.orderId}` },
      db
    );
    assert.equal(committed.ok, true);
    if (!committed.ok) return;
    assert.equal(committed.fieldSchemaVersion, BUYER_CSV_V4_FIELD_SCHEMA_VERSION);
    assert.equal(committed.rowCount, preview.rowCount);

    const generatedPkg = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committed.exportId },
    });
    assert.equal(generatedPkg.spreadsheetDeliveredAt, null);
    const header = generatedPkg.csvContent.split("\n")[0]!.split(",");
    assert.equal(header[0], "Date Generated");
    assert.equal(header[1], "Lead Type");
    const dataRows = generatedPkg.csvContent.trimEnd().split("\n").slice(1);
    assert.equal(dataRows.length, committed.rowCount);
    assert.ok(dataRows.every((row) => row.split(",")[1] === "Veteran"));
    assert.equal(header.includes("ZIP"), false);
    assert.equal(header.includes("Coverage Amount"), false);
    assert.ok(header.includes("Branch of Service"));
    assert.ok(header.includes("Primary Concern"));

    const dates = dataRows.map((row) => row.split(",")[0]!);
    assert.deepEqual(dates, [...dates].sort().reverse());

    const unreleased = await findReleasedLeadDeliveryExportPackageForClient(
      {
        exportId: committed.exportId,
        leadOrderId: fixtures.orderId,
        clientAccountId: fixtures.buyerClientId,
      },
      db
    );
    assert.equal(unreleased, null);

    const customerBefore = await getClientReleasedDeliveryDownload(
      {
        orderId: fixtures.orderId,
        exportId: committed.exportId,
        clientAccountId: fixtures.buyerClientId,
      },
      { db }
    );
    assert.equal(customerBefore, null);

    const released = await markSpreadsheetDelivered(
      {
        exportId: committed.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `v4-release-${committed.exportId}`,
        deliveredBy: "v4-presentation-test",
      },
      db,
      { send: async () => ({ ok: true, id: "v4-skip-notify" }) }
    );
    assert.equal(released.ok, true);

    const adminDownload = await getBuyerCsvExportDownload(committed.exportId, db);
    assert.equal(adminDownload.ok, true);
    if (!adminDownload.ok) return;
    assert.equal(adminDownload.csv, generatedPkg.csvContent);
    assert.equal(adminDownload.spreadsheetDelivered, true);

    const customerAfter = await getClientReleasedDeliveryDownload(
      {
        orderId: fixtures.orderId,
        exportId: committed.exportId,
        clientAccountId: fixtures.buyerClientId,
      },
      { db }
    );
    assert.ok(customerAfter);
    assert.equal(customerAfter.csv, generatedPkg.csvContent);
    assert.equal(customerAfter.csv, adminDownload.csv);

    const foreign = await getClientReleasedDeliveryDownload(
      {
        orderId: fixtures.orderId,
        exportId: committed.exportId,
        clientAccountId: fixtures.otherBuyerClientId,
      },
      { db }
    );
    assert.equal(foreign, null);

    const historicalCsv = serializeBuyerCsvV3(
      [
        {
          first_name: "Hist",
          last_name: "V3",
          phone: "+15550000000",
          email: "hist@example.test",
          state: "TX",
          zip: "75001",
          age: "61",
          lead_date: "2024-01-01",
          niche: "vet",
          beneficiary: "",
          coverage_amount: "",
          branch_of_service: "Navy",
          disability_rating: "",
          primary_concern: "",
        },
      ],
      "vet"
    );
    const historical = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: fixtures.orderId,
        clientAccountId: fixtures.buyerClientId,
        rowCount: 1,
        contentSha256: "historical-v3-sha",
        idempotencyKey: `v4-hist-v3-${fixtures.orderId}`,
        fieldSchemaVersion: BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
        allocationIdsJson: ["alloc_historical_v3"],
        csvContent: historicalCsv,
        spreadsheetDeliveredAt: new Date("2026-07-01T00:00:00.000Z"),
        spreadsheetDeliveredBy: "historical",
        spreadsheetDeliveryIdempotencyKey: `v4-hist-del-${fixtures.orderId}`,
      },
    });

    const historicalDownload = await getBuyerCsvExportDownload(historical.id, db);
    assert.equal(historicalDownload.ok, true);
    if (!historicalDownload.ok) return;
    assert.equal(historicalDownload.csv, historicalCsv);
    assert.equal(historicalDownload.fieldSchemaVersion, BUYER_CSV_V3_FIELD_SCHEMA_VERSION);
    assert.equal(historicalDownload.csv.split("\n")[0]!.split(",")[0], "first_name");

    const historicalCustomer = await getClientReleasedDeliveryDownload(
      {
        orderId: fixtures.orderId,
        exportId: historical.id,
        clientAccountId: fixtures.buyerClientId,
      },
      { db }
    );
    assert.ok(historicalCustomer);
    assert.equal(historicalCustomer.csv, historicalCsv);
  });
});
