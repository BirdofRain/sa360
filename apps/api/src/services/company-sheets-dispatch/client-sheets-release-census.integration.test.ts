/**
 * Local sa360_test proof for the history census and one-batch prepare route.
 * No Google calls. Sheets setup and execution stay off.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";

import { PrismaClient } from "@prisma/client";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_LEAD_HEADER,
} from "../../lib/company-google-sheets-env.js";
import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminCompanySheetsDeliveryRoutes } from "../../routes/company-sheets-delivery.js";
import { SHEETS_PERSON_POLICY } from "./client-sheets-person-gate.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

describe("client sheets release census (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientId = `census_${suffix}`;
  const otherId = `census_other_${suffix}`;
  const sheetId = `sheetCensus${suffix}`;
  const otherSheetId = `sheetCensusOther${suffix}`;
  const claimToken = `secret-claim-${suffix}`;
  const phoneA = "+15558001001";
  const phoneB = "+15558001002";
  const zapEmail = `zap-secret-${suffix}@example.com`;
  const cutoff = new Date("2026-10-27T14:43:39.233Z");
  let connectionId = "";
  let createdConnection = false;
  let googleCalls = 0;
  let app: ReturnType<typeof Fastify>;
  const previousAdmin = process.env.ADMIN_API_KEY;
  const previousSheets = process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
  const previousExecution = process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED;
  const previousCaptured = process.env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    process.env.ADMIN_API_KEY = "census-admin-key";
    process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = "false";
    process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED = "false";
    process.env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED = "false";
    await db.clientAccount.createMany({
      data: [clientId, otherId].map((clientAccountId) => ({
        clientAccountId,
        clientDisplayName: clientAccountId,
        status: "active",
      })),
    });
    let connection = await db.companyGoogleConnection.findUnique({ where: { connectionKey: "life_agent_launch" } });
    if (!connection) {
      connection = await db.companyGoogleConnection.create({
        data: {
          connectionKey: "life_agent_launch",
          googleUserId: `census-${suffix}`,
          googleEmail: "census@lifeagentlaunch.test",
          status: "connected",
          scopes: ["openid", "email"],
          tokenVersion: 1,
        },
      });
      createdConnection = true;
    }
    connectionId = connection.id;
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId: clientId,
        companyConnectionId: connectionId,
        spreadsheetId: sheetId,
        spreadsheetTitle: "Census",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}`,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: false,
        campaignDispatchNotBefore: cutoff,
        agedDispatchEnabled: false,
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "aged",
        setupState: "creating",
        worksheetId: null,
        worksheetTitle: null,
      },
    });
    const otherDestination = await db.companySheetsDestination.create({
      data: {
        clientAccountId: otherId,
        companyConnectionId: connectionId,
        spreadsheetId: otherSheetId,
        spreadsheetTitle: "Other",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${otherSheetId}`,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: false,
      },
    });
    const leadA = await makeLead(clientId, "a", phoneA);
    const leadB = await makeLead(clientId, "b", phoneB);
    const otherLead = await makeLead(otherId, "other", "+15558001999");
    await makeJob({
      clientAccountId: clientId,
      destinationId: destination.id,
      spreadsheetId: sheetId,
      leadId: leadA.id,
      status: "succeeded",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      rowsWritten: 1,
    });
    await makeJob({
      clientAccountId: clientId,
      destinationId: destination.id,
      spreadsheetId: sheetId,
      leadId: leadB.id,
      status: "succeeded",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      rowsWritten: 1,
    });
    const held = await makeJob({
      clientAccountId: clientId,
      destinationId: destination.id,
      spreadsheetId: sheetId,
      leadId: null,
      status: "running",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      rowsWritten: 0,
      startedAt: new Date(),
      claimToken,
    });
    await makeJob({
      clientAccountId: clientId,
      destinationId: destination.id,
      spreadsheetId: sheetId,
      leadId: null,
      status: "running",
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      rowsWritten: 0,
      startedAt: new Date(Date.now() - 380_000 - 60_000),
      updatedAt: new Date(Date.now() - 380_000 - 60_000),
    });
    const queuedLead = await makeLead(clientId, "queued", "+15558001003");
    await makeJob({
      clientAccountId: clientId,
      destinationId: destination.id,
      spreadsheetId: sheetId,
      leadId: queuedLead.id,
      status: "queued",
      createdAt: new Date("2026-01-05T00:00:00.000Z"),
      rowsWritten: 0,
    });
    await makeJob({
      clientAccountId: otherId,
      destinationId: otherDestination.id,
      spreadsheetId: otherSheetId,
      leadId: otherLead.id,
      status: "succeeded",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      rowsWritten: 1,
    });
    await db.companySheetsWorksheetLock.create({
      data: { spreadsheetId: sheetId, worksheetId: 7, ownerJobId: held.id, lockedAt: new Date("2026-11-02T12:00:00.000Z") },
    });
    await db.clientSheetsPersonAdmission.create({
      data: {
        clientAccountId: clientId,
        kind: "email",
        normalizedValue: zapEmail,
        fingerprint: fingerprintIdentityValue("email", zapEmail),
        historicalImportKey: `zap:${clientId}:${suffix}`,
        status: "admitted",
        policy: SHEETS_PERSON_POLICY,
        origin: "historical_baseline",
      },
    });
    await db.clientSheetsPersonAdmission.create({
      data: {
        clientAccountId: clientId,
        kind: "email",
        normalizedValue: `unknown-${suffix}@example.com`,
        fingerprint: fingerprintIdentityValue("email", `unknown-${suffix}@example.com`),
        status: "reserved",
        policy: SHEETS_PERSON_POLICY,
        origin: "operator_note",
      },
    });
    app = Fastify();
    await app.register(adminCompanySheetsDeliveryRoutes, {
      prefix: "/admin/v1",
      deps: {
        db,
        env: process.env,
        appendValues: async () => {
          googleCalls += 1;
          throw new Error("append");
        },
        getValues: async () => {
          googleCalls += 1;
          throw new Error("read");
        },
        updateValues: async () => {
          googleCalls += 1;
          throw new Error("update");
        },
      },
    });
  });

  after(async () => {
    if (app) await app.close();
    if (db) {
      const ids = [clientId, otherId];
      await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: { in: [sheetId, otherSheetId] } } });
      await db.clientSheetsPersonAdmission.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.clientSheetsPersonRelease.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.clientSheetsHistoryCoverage.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.clientSheetsDedupeDecision.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.sourceLeadEvent.deleteMany({ where: { clientAccountIdResolved: { in: ids } } });
      if (createdConnection) {
        const leftover = await db.companySheetsDestination.count({ where: { companyConnectionId: connectionId } });
        if (leftover === 0) await db.companyGoogleConnection.delete({ where: { id: connectionId } });
      }
      await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
      await db.$disconnect();
    }
    if (previousAdmin === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdmin;
    if (previousSheets === undefined) delete process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = previousSheets;
    if (previousExecution === undefined) delete process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED = previousExecution;
    if (previousCaptured === undefined) delete process.env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED;
    else process.env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED = previousCaptured;
  });

  async function makeLead(clientAccountId: string, label: string, phone: string) {
    return db.sourceLeadEvent.create({
      data: {
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        sourceLeadUid: `census_${suffix}_${label}`,
        clientAccountIdResolved: clientAccountId,
        status: "routing_matched",
        rawPayloadJson: { fixture: true },
        normalizedPayloadJson: { full_name: `Census ${label}`, phone },
        receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  }

  async function makeJob(input: {
    clientAccountId: string;
    destinationId: string;
    spreadsheetId: string;
    leadId: string | null;
    status: string;
    createdAt: Date;
    rowsWritten: number;
    startedAt?: Date;
    updatedAt?: Date;
    claimToken?: string;
  }) {
    return db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: input.status,
        clientAccountId: input.clientAccountId,
        companyConnectionId: connectionId,
        destinationId: input.destinationId,
        spreadsheetId: input.spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: cutoff,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        idempotencyKey: `census:${input.clientAccountId}:${input.leadId ?? input.status}:${input.createdAt.toISOString()}`,
        sourceLeadEventId: input.leadId,
        rowsTotal: 1,
        rowsWritten: input.rowsWritten,
        createdAt: input.createdAt,
        startedAt: input.startedAt,
        updatedAt: input.updatedAt,
        claimToken: input.claimToken,
      },
    });
  }

  function authHeaders() {
    return { "x-sa360-admin-key": "census-admin-key" };
  }

  it("reads one client, prepares one bounded batch idempotently, and does not write externally", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/admin/v1/clients/census_missing/google-sheets/history",
      headers: authHeaders(),
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().googleCalled, false);

    const tooSmall = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientId}/google-sheets/history/prepare`,
      headers: authHeaders(),
      payload: { batchSize: 0 },
    });
    assert.equal(tooSmall.statusCode, 400);
    assert.equal(tooSmall.json().error, "invalid_batch_size");
    const tooLarge = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientId}/google-sheets/history/prepare`,
      headers: authHeaders(),
      payload: { batchSize: 501 },
    });
    assert.equal(tooLarge.statusCode, 400);
    const mismatched = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientId}/google-sheets/history/prepare`,
      headers: authHeaders(),
      payload: { clientAccountId: otherId, batchSize: 1 },
    });
    assert.equal(mismatched.statusCode, 400);
    assert.equal(mismatched.json().error, "client_mismatch");
    assert.equal(await db.clientSheetsHistoryCoverage.count({ where: { clientAccountId: clientId } }), 0);

    const before = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${clientId}/google-sheets/history`,
      headers: authHeaders(),
    });
    assert.equal(before.statusCode, 200);
    const beforeBody = before.json();
    assert.equal(beforeBody.googleCalled, false);
    assert.equal(beforeBody.delivered, false);
    assert.equal(beforeBody.census.history.status, "unavailable");
    assert.equal(beforeBody.census.history.completenessProof, "not_started");
    assert.equal(beforeBody.census.history.sa360JobHistoryComplete, false);
    assert.equal(beforeBody.census.admissions.importedZapHistory.total, 1);
    assert.equal(beforeBody.census.admissions.sa360JobIndex.total, 0);
    assert.equal(beforeBody.census.admissions.unknownOrigins[0].origin, "operator_note");
    assert.equal(beforeBody.census.jobs.byKindStatus.find((row: { status: string }) => row.status === "succeeded").count, 2);
    assert.equal(beforeBody.census.jobs.open.length, 3);
    assert.equal(beforeBody.census.jobs.open.filter((row: { claimWithinLease: boolean }) => row.claimWithinLease).length, 1);
    assert.equal(beforeBody.census.jobs.open.filter((row: { claimHeld: boolean }) => row.claimHeld).length, 2);
    assert.equal(beforeBody.census.locks.length, 1);
    assert.equal(beforeBody.census.locks[0].worksheetId, 7);
    assert.equal(beforeBody.census.creatingTabs[0].role, "aged");
    assert.equal(beforeBody.census.quarantine.ran, false);
    assert.equal(beforeBody.census.quarantine.count, 1);
    assert.equal(beforeBody.census.switches.campaignDispatchEnabled, false);
    assert.equal(beforeBody.census.switches.campaignDispatchNotBefore, cutoff.toISOString());
    assert.equal(beforeBody.census.switches.readOnly, true);
    const beforeText = JSON.stringify(beforeBody);
    assert.equal(beforeText.includes(sheetId), false);
    assert.equal(beforeText.includes(claimToken), false);
    assert.equal(beforeText.includes(phoneA), false);
    assert.equal(beforeText.includes(zapEmail), false);
    assert.match(beforeText, /Unimported Zap deliveries are not counted/);
    assert.match(beforeText, /one client only/);

    const first = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientId}/google-sheets/history/prepare`,
      headers: authHeaders(),
      payload: { batchSize: 1 },
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.googleCalled, false);
    assert.equal(firstBody.delivered, false);
    assert.equal(firstBody.batchSize, 1);
    assert.equal(firstBody.census.history.status, "partial");
    assert.equal(firstBody.census.history.completenessProof, "cursor_open");
    assert.equal(firstBody.census.history.sa360JobHistoryComplete, false);
    assert.equal(firstBody.census.history.observedJobCount, 1);
    assert.equal(firstBody.census.history.indexedCount, 1);
    assert.equal(firstBody.census.admissions.sa360JobIndex.total, 1);
    assert.equal(firstBody.census.admissions.importedZapHistory.total, 1);

    const second = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientId}/google-sheets/history/prepare`,
      headers: authHeaders(),
      payload: { batchSize: 1 },
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    assert.equal(secondBody.census.history.status, "complete");
    assert.equal(secondBody.census.history.completenessProof, "cursor_exhausted");
    assert.equal(secondBody.census.history.sa360JobHistoryComplete, true);
    assert.equal(secondBody.census.history.observedJobCount, 2);
    assert.equal(secondBody.census.history.indexedCount, 2);
    assert.equal(secondBody.census.admissions.sa360JobIndex.origin, "delivery_index");

    const third = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientId}/google-sheets/history/prepare`,
      headers: authHeaders(),
      payload: { batchSize: 1 },
    });
    assert.equal(third.statusCode, 200);
    const thirdBody = third.json();
    assert.equal(thirdBody.census.history.observedJobCount, 2);
    assert.equal(thirdBody.census.history.indexedCount, 2);
    assert.equal(thirdBody.census.history.completenessProof, "cursor_exhausted");
    assert.equal(thirdBody.census.admissions.sa360JobIndex.total, 2);
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { clientAccountId: clientId, origin: "delivery_index" } }), 2);
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { clientAccountId: otherId } }), 0);

    const other = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${otherId}/google-sheets/history`,
      headers: authHeaders(),
    });
    assert.equal(other.statusCode, 200);
    const otherBody = other.json();
    assert.equal(otherBody.census.history.status, "unavailable");
    assert.equal(otherBody.census.admissions.sa360JobIndex.total, 0);
    assert.equal(otherBody.census.admissions.importedZapHistory.total, 0);
    assert.equal(otherBody.census.jobs.byKindStatus.find((row: { status: string }) => row.status === "succeeded").count, 1);

    const jobs = await db.companySheetsDeliveryJob.findMany({ where: { clientAccountId: clientId } });
    assert.deepEqual(
      jobs.map((job) => job.status).sort(),
      ["queued", "running", "running", "succeeded", "succeeded"]
    );
    assert.equal(jobs.every((job) => job.rowsWritten === 0 || job.rowsWritten === 1), true);
    assert.equal(jobs.filter((job) => job.status === "succeeded").every((job) => job.rowsWritten === 1), true);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), cutoff.toISOString());
    assert.equal(destination.agedDispatchEnabled, false);
    assert.equal(destination.enabled, false);
    assert.equal(googleCalls, 0);
    assert.equal(JSON.stringify(thirdBody).includes(sheetId), false);
  });
});
