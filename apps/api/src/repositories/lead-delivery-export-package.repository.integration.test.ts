import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import {
  findReleasedLeadDeliveryExportPackageForClient,
  listReleasedLeadDeliveryExportPackagesForOrder,
} from "./lead-delivery-export-package.repository.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

describe("released export package customer reads", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const owner = `acct_rel_${suffix}`;
  const other = `acct_oth_${suffix}`;
  let orderId = "";
  let otherOrderId = "";
  let releasedId = "";
  let unreleasedId = "";
  let secondReleasedId = "";

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });

    const ownerOrder = await db.leadOrder.create({
      data: {
        orderNumber: `LO-REL-${suffix}`,
        clientAccountId: owner,
        clientDisplayName: "Valley Vet",
        status: "active",
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 25,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
      },
    });
    orderId = ownerOrder.id;

    const otherOrder = await db.leadOrder.create({
      data: {
        orderNumber: `LO-OTH-${suffix}`,
        clientAccountId: other,
        status: "active",
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 5,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
      },
    });
    otherOrderId = otherOrder.id;

    const unreleased = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: orderId,
        clientAccountId: owner,
        rowCount: 10,
        contentSha256: "unreleased-sha",
        idempotencyKey: `rel-unreleased-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc_hidden"],
        csvContent: "secret,unreleased\n",
        createdBy: "operator_alex",
      },
    });
    unreleasedId = unreleased.id;

    const released = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: orderId,
        clientAccountId: owner,
        rowCount: 10,
        contentSha256: "released-sha-1",
        idempotencyKey: `rel-released-1-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc_a"],
        csvContent: "first_name,last_name\nAda,Lovelace\n",
        spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
        spreadsheetDeliveredBy: "operator_alex",
        spreadsheetDeliveryIdempotencyKey: `rel-del-1-${suffix}`,
      },
    });
    releasedId = released.id;

    const second = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: orderId,
        clientAccountId: owner,
        rowCount: 5,
        contentSha256: "released-sha-2",
        idempotencyKey: `rel-released-2-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc_b"],
        csvContent: "first_name,last_name\nGrace,Hopper\n",
        spreadsheetDeliveredAt: new Date("2026-08-21T15:00:00.000Z"),
        spreadsheetDeliveredBy: "operator_alex",
        spreadsheetDeliveryIdempotencyKey: `rel-del-2-${suffix}`,
      },
    });
    secondReleasedId = second.id;
  });

  after(async () => {
    if (!db) return;
    await db.companySheetsDeliveryJob.deleteMany({
      where: { clientAccountId: { in: [owner, other] } },
    });
    await db.leadDeliveryExportPackage.deleteMany({
      where: { leadOrderId: { in: [orderId, otherOrderId].filter(Boolean) } },
    });
    await db.leadOrder.deleteMany({
      where: { id: { in: [orderId, otherOrderId].filter(Boolean) } },
    });
    await db.$disconnect();
  });

  it("lists only released packages and preserves multiple batches", async () => {
    const items = await listReleasedLeadDeliveryExportPackagesForOrder(
      { leadOrderId: orderId, clientAccountId: owner },
      db
    );
    assert.deepEqual(
      items.map((row) => row.id),
      [releasedId, secondReleasedId]
    );
    assert.equal(items.some((row) => row.id === unreleasedId), false);
    assert.equal(items[0]?.csvContent, "first_name,last_name\nAda,Lovelace\n");
    assert.equal(items[1]?.rowCount, 5);
  });

  it("treats unreleased, missing, and cross-tenant lookups as not found", async () => {
    const unreleased = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: unreleasedId, leadOrderId: orderId, clientAccountId: owner },
      db
    );
    const missing = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: "pkg_missing", leadOrderId: orderId, clientAccountId: owner },
      db
    );
    const foreign = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: releasedId, leadOrderId: orderId, clientAccountId: other },
      db
    );
    const wrongOrder = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: releasedId, leadOrderId: otherOrderId, clientAccountId: owner },
      db
    );
    assert.equal(unreleased, null);
    assert.equal(missing, null);
    assert.equal(foreign, null);
    assert.equal(wrongOrder, null);

    const owned = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: releasedId, leadOrderId: orderId, clientAccountId: owner },
      db
    );
    assert.ok(owned);
    assert.equal(owned.csvContent, "first_name,last_name\nAda,Lovelace\n");
    assert.equal(owned.spreadsheetDeliveredAt?.toISOString(), "2026-08-20T15:00:00.000Z");
    assert.equal(owned.clientDownloadAuthorizedAt.toISOString(), "2026-08-20T15:00:00.000Z");
  });

  it("authorizes a verified Sheets delivery without the operator receipt", async () => {
    const automated = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: orderId,
        clientAccountId: owner,
        rowCount: 2,
        contentSha256: "sheets-sha",
        idempotencyKey: `rel-sheets-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc_sheets"],
        csvContent: "first_name,last_name\nLin,Type\n",
      },
    });
    const queued = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: orderId,
        clientAccountId: owner,
        rowCount: 1,
        contentSha256: "queued-sha",
        idempotencyKey: `rel-queued-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc_queued"],
        csvContent: "first_name,last_name\nQueued,Only\n",
      },
    });
    const uncertain = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: orderId,
        clientAccountId: owner,
        rowCount: 1,
        contentSha256: "uncertain-sha",
        idempotencyKey: `rel-uncertain-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc_uncertain"],
        csvContent: "first_name,last_name\nUncertain,Job\n",
      },
    });
    const job = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "aged_release",
        status: "succeeded",
        clientAccountId: owner,
        companyConnectionId: `conn_${suffix}`,
        spreadsheetId: `sheet_ok_${suffix}`,
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_ok",
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        headerContract: ["delivery_row_id"],
        idempotencyKey: `job-ok-${suffix}`,
        rowsTotal: 1,
        leadOrderId: orderId,
        exportPackageId: automated.id,
      },
    });
    const evidence = await db.companySheetsOrderDeliveryEvidence.create({
      data: {
        leadOrderId: orderId,
        exportPackageId: automated.id,
        clientAccountId: owner,
        jobId: job.id,
        spreadsheetId: job.spreadsheetId,
        spreadsheetUrl: job.spreadsheetUrl,
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        status: "succeeded",
      },
    });
    const queuedJob = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "aged_release",
        status: "queued",
        clientAccountId: owner,
        companyConnectionId: `conn_${suffix}`,
        spreadsheetId: `sheet_q_${suffix}`,
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_q",
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        headerContract: ["delivery_row_id"],
        idempotencyKey: `job-q-${suffix}`,
        rowsTotal: 1,
        leadOrderId: orderId,
        exportPackageId: queued.id,
      },
    });
    await db.companySheetsOrderDeliveryEvidence.create({
      data: {
        leadOrderId: orderId,
        exportPackageId: queued.id,
        clientAccountId: owner,
        jobId: queuedJob.id,
        spreadsheetId: queuedJob.spreadsheetId,
        spreadsheetUrl: queuedJob.spreadsheetUrl,
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        status: "queued",
      },
    });
    const uncertainJob = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "aged_release",
        status: "uncertain",
        clientAccountId: owner,
        companyConnectionId: `conn_${suffix}`,
        spreadsheetId: `sheet_u_${suffix}`,
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_u",
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        headerContract: ["delivery_row_id"],
        idempotencyKey: `job-u-${suffix}`,
        rowsTotal: 1,
        leadOrderId: orderId,
        exportPackageId: uncertain.id,
      },
    });
    await db.companySheetsOrderDeliveryEvidence.create({
      data: {
        leadOrderId: orderId,
        exportPackageId: uncertain.id,
        clientAccountId: owner,
        jobId: uncertainJob.id,
        spreadsheetId: uncertainJob.spreadsheetId,
        spreadsheetUrl: uncertainJob.spreadsheetUrl,
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        status: "succeeded",
      },
    });

    const found = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: automated.id, leadOrderId: orderId, clientAccountId: owner },
      db
    );
    assert.ok(found);
    assert.equal(found.spreadsheetDeliveredAt, null);
    assert.equal(found.clientDownloadAuthorizedAt.toISOString(), evidence.updatedAt.toISOString());
    assert.equal(found.csvContent, "first_name,last_name\nLin,Type\n");
    const stored = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: automated.id } });
    assert.equal(stored.spreadsheetDeliveredAt, null);

    const items = await listReleasedLeadDeliveryExportPackagesForOrder(
      { leadOrderId: orderId, clientAccountId: owner },
      db
    );
    assert.deepEqual(items.map((row) => row.id), [releasedId, secondReleasedId, automated.id]);
    assert.equal(items.some((row) => row.id === queued.id || row.id === uncertain.id || row.id === unreleasedId), false);

    const foreign = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: automated.id, leadOrderId: orderId, clientAccountId: other },
      db
    );
    const wrongOrder = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: automated.id, leadOrderId: otherOrderId, clientAccountId: owner },
      db
    );
    const queuedFound = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: queued.id, leadOrderId: orderId, clientAccountId: owner },
      db
    );
    const uncertainFound = await findReleasedLeadDeliveryExportPackageForClient(
      { exportId: uncertain.id, leadOrderId: orderId, clientAccountId: owner },
      db
    );
    assert.equal(foreign, null);
    assert.equal(wrongOrder, null);
    assert.equal(queuedFound, null);
    assert.equal(uncertainFound, null);
  });
});
