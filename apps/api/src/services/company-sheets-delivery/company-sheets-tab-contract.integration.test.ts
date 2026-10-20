/**
 * Local sa360_test coverage for tab contracts and unresolved appends.
 * No live Google calls.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { COMPANY_SHEETS_RELEASE_HOLD_PHRASE } from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { sha256Hex } from "../ppl-fulfillment/buyer-csv-export.service.js";
import { getCompanySheetsDestinationForClient } from "../company-google/company-sheets-destination.service.js";
import {
  enqueueAuthorizedAgedReleaseSheetsDelivery,
  enqueueConfirmedLeadSheetsDelivery,
  executeCompanySheetsDeliveryJob,
  releaseCompanySheetsDeliveryHold,
} from "./company-sheets-delivery.service.js";
import { adminCompanySheetsDeliveryRoutes } from "../../routes/company-sheets-delivery.js";
import {
  bindCompanySheetsTab,
  createMissingCompanySheetsTab,
  inspectCompanySheetsTabs,
  listCompanySheetsTabContracts,
} from "./company-sheets-tab-contract.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "tabs@lifeagentlaunch.test";

describe("company sheets tab contracts (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `tab${Date.now()}`;
  const clientId = `cst_${suffix}`;
  const otherClientId = `cst_other_${suffix}`;
  const sheet = `sheetTab${suffix}`;
  const calls: string[] = [];
  const methods: string[] = [];
  let connectionId = "";
  let orderId = "";

  function env(sheetsEnabled: boolean, execution = false): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: sheetsEnabled ? "true" : "false",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: execution ? "true" : "false",
    };
  }

  function deps(sheetsEnabled = true, execution = true) {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      methods.push(init?.method ?? "GET");
      if (url.includes(":batchUpdate")) {
        return json(200, {
          replies: [{ addSheet: { properties: { sheetId: 11, title: "Campaign Leads", sheetType: "GRID" } } }],
        });
      }
      if ((init?.method ?? "GET") === "PUT") throw new Error("status read must not write values");
      const decoded = decodeURIComponent(url);
      if (decoded.includes("A1:ZZ2")) return json(200, { values: [["Name"]] });
      if (decoded.includes("!A1:A")) return json(200, { values: [["Name"]] });
      return json(200, { values: [] });
    };
    return {
      env: env(sheetsEnabled, execution),
      db,
      now: () => new Date(),
      fetchImpl,
      getAccessToken: async () => ({
        ok: true as const,
        accessToken: "ya29.tab-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      }),
      getMetadata: async () => ({
        ok: true as const,
        metadata: {
          spreadsheetId: sheet,
          title: "Client",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheet}`,
          worksheets: [
            { sheetId: 4, title: "Existing", index: 0, hidden: false, sheetType: "GRID" },
            { sheetId: 5, title: "Empty", index: 1, hidden: false, sheetType: "GRID" },
          ],
        },
      }),
      getDriveFile: async () => ({
        ok: true as const,
        file: {
          id: sheet,
          name: "Client",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: [EMAIL],
          driveId: null,
        },
      }),
      getValues: async (input: { range: string }) => {
        calls.push(input.range);
        methods.push("GET");
        if (input.range.includes("Empty")) return { ok: true as const, values: [] as string[][] };
        return { ok: true as const, values: [["Name"]] };
      },
    };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: clientId, clientDisplayName: "Tabs", status: "active" },
        { clientAccountId: otherClientId, clientDisplayName: "Other", status: "active" },
      ],
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: "life_agent_launch",
        googleUserId: `company-tabs-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
          "https://www.googleapis.com/auth/drive.file",
        ],
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    await db.companySheetsDestination.create({
      data: {
        clientAccountId: clientId,
        companyConnectionId: connectionId,
        spreadsheetId: sheet,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheet}`,
        worksheetId: 4,
        worksheetTitle: "Existing",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
      },
    });
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup() {
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: [clientId, otherClientId] } } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: sheet } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: [clientId, otherClientId] } } });
    await db.companyGoogleConnection.deleteMany({ where: { googleUserId: `company-tabs-${suffix}` } });
    if (orderId) {
      await db.leadDeliveryExportPackage.deleteMany({ where: { leadOrderId: orderId } });
      await db.leadOrder.deleteMany({ where: { id: orderId } });
    }
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: [clientId, otherClientId] } } });
  }

  it("does not call Google for status, and setup stays off when the sheets flag is off", async () => {
    calls.length = 0;
    const listed = await listCompanySheetsTabContracts(clientId, deps(false, false));
    assert.equal(listed.ok, true);
    const portal = await getCompanySheetsDestinationForClient(clientId, { db });
    assert.equal(portal.destination?.tabContracts.find((tab) => tab.role === "campaign")?.setupState, "missing");
    const blocked = await createMissingCompanySheetsTab(clientId, { role: "campaign" }, deps(false, false));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "destination_disabled");
    const inspect = await inspectCompanySheetsTabs(clientId, {}, deps(false, false));
    assert.equal(inspect.ok, false);
    assert.equal(calls.length, 0);
  });

  it("refuses an incompatible tab without writing and binds a compatible empty tab", async () => {
    calls.length = 0;
    methods.length = 0;
    const rejected = await bindCompanySheetsTab(
      clientId,
      { role: "campaign", worksheetId: 4 },
      deps()
    );
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "tab_incompatible");
    assert.equal(methods.includes("PUT"), false);
    assert.equal(methods.some((method) => method === "POST"), false);
    const stored = await db.companySheetsTabContract.findFirstOrThrow({
      where: { role: "campaign", destination: { clientAccountId: clientId } },
    });
    assert.equal(stored.setupState, "incompatible");

    const bound = await bindCompanySheetsTab(clientId, { role: "campaign", worksheetId: 5 }, deps());
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(bound.contract.worksheetId, 5);
    assert.equal(bound.contract.schemaVersion, "company_sheets_campaign_v1");
    assert.equal(methods.includes("PUT"), false);
  });

  it("creates a missing tab once and does not write header values", async () => {
    await db.companySheetsTabContract.deleteMany({
      where: { role: "campaign", destination: { clientAccountId: clientId } },
    });
    const conflict = await createMissingCompanySheetsTab(clientId, { role: "campaign" }, {
      ...deps(),
      getMetadata: async () => ({
        ok: true as const,
        metadata: {
          spreadsheetId: sheet,
          title: "Client",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheet}`,
          worksheets: [{ sheetId: 4, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" }],
        },
      }),
      fetchImpl: async () => {
        throw new Error("existing tab must not be recreated");
      },
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.code, "tab_title_exists");
    methods.length = 0;
    const created = await createMissingCompanySheetsTab(clientId, { role: "campaign" }, deps());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.createdSheet.worksheetId, 11);
    assert.equal(created.contract.setupState, "bound");
    assert.equal(methods.includes("PUT"), false);
    assert.equal(methods.filter((method) => method === "POST").length, 1);
    const again = await createMissingCompanySheetsTab(clientId, { role: "campaign" }, deps());
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "tab_already_bound");
  });

  it("rejects an aged package whose order belongs to another client and a mismatched schema", async () => {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-TAB-${suffix}`,
        clientAccountId: otherClientId,
        status: "active",
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 1,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
      },
    });
    orderId = order.id;
    const csv = "first_name,note\nAda,one\n";
    const pkg = await db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: order.id,
        clientAccountId: clientId,
        rowCount: 1,
        contentSha256: sha256Hex(csv),
        idempotencyKey: `cst-pkg-${suffix}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: ["alloc-1"],
        csvContent: csv,
        spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
        spreadsheetDeliveredBy: "operator_alex",
        spreadsheetDeliveryIdempotencyKey: `cst-del-${suffix}`,
      },
    });
    const mismatch = await enqueueAuthorizedAgedReleaseSheetsDelivery(pkg.id, deps(true, true));
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "order_client_mismatch");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: pkg.id } }), 0);

    await db.leadOrder.update({ where: { id: order.id }, data: { clientAccountId: clientId } });
    const unbound = await enqueueAuthorizedAgedReleaseSheetsDelivery(pkg.id, deps(true, true));
    assert.equal(unbound.ok, false);
    if (!unbound.ok) assert.equal(unbound.code, "tab_missing");
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "aged",
        setupState: "bound",
        worksheetId: 5,
        worksheetTitle: "Aged Orders",
        schemaVersion: "buyer_csv_v9",
        headerContract: ["delivery_row_id", "other"],
        boundAt: new Date(),
      },
    });
    const schema = await enqueueAuthorizedAgedReleaseSheetsDelivery(pkg.id, deps(true, true));
    assert.equal(schema.ok, false);
    if (!schema.ok) assert.equal(schema.code, "schema_mismatch");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: pkg.id } }), 0);
    assert.equal(await db.leadAllocation.count({ where: { leadOrderId: order.id } }), 0);
  });

  it("snapshots campaign and aged worksheets separately and does not append over an unresolved request", async () => {
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    await db.companySheetsTabContract.deleteMany({ where: { destinationId: destination.id, role: "aged" } });
    await db.companySheetsTabContract.upsert({
      where: { destinationId_role: { destinationId: destination.id, role: "aged" } },
      create: {
        destinationId: destination.id,
        role: "aged",
        setupState: "bound",
        worksheetId: 5,
        worksheetTitle: "Aged Orders",
        schemaVersion: "buyer_csv_v2",
        headerContract: ["delivery_row_id", "first_name", "note"],
        boundAt: new Date(),
      },
      update: {
        setupState: "bound",
        worksheetId: 5,
        worksheetTitle: "Aged Orders",
        schemaVersion: "buyer_csv_v2",
        headerContract: ["delivery_row_id", "first_name", "note"],
      },
    });
    async function createLead(phone: string) {
      return db.sourceLeadEvent.create({
        data: {
          sourceLeadUid: `uid_${suffix}_${phone}`,
          sourceProvider: "manual_import",
          sourceSystem: "external_vendor",
          sourceType: "manual_entry",
          rawPayloadJson: { untouched: true },
          clientAccountIdResolved: clientId,
          status: "approved",
          normalizedPayloadJson: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", phone },
          enrichmentMetadataJson: { source: "tab-test" },
        },
      });
    }
    const lead = await createLead("+15551212");
    const secondLead = await createLead("+15551213");
    const pkg = await db.leadDeliveryExportPackage.findFirstOrThrow({ where: { clientAccountId: clientId } });
    const campaign = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps(true, true));
    const aged = await enqueueAuthorizedAgedReleaseSheetsDelivery(pkg.id, deps(true, true));
    const sibling = await enqueueConfirmedLeadSheetsDelivery(secondLead.id, deps(true, true));
    assert.equal(campaign.ok, true);
    assert.equal(aged.ok, true);
    assert.equal(sibling.ok, true);
    if (!campaign.ok || !aged.ok || !sibling.ok) return;
    assert.equal(campaign.job.worksheetId, 11);
    assert.equal(aged.job.worksheetId, 5);
    assert.notEqual(campaign.job.worksheetId, aged.job.worksheetId);
    assert.equal(campaign.job.schemaVersion, "company_sheets_campaign_v1");
    assert.equal(aged.job.schemaVersion, "buyer_csv_v2");
    const evidence = await db.companySheetsOrderDeliveryEvidence.findUniqueOrThrow({ where: { jobId: aged.job.id } });
    assert.equal(evidence.worksheetId, 5);
    assert.equal(evidence.worksheetTitle, "Aged Orders");

    await db.companySheetsDeliveryJob.update({
      where: { id: campaign.job.id },
      data: {
        status: "running",
        startedAt: new Date(Date.now() - 180_000),
        appendStartedAt: new Date(Date.now() - 180_000),
        claimToken: "stale-worker",
      },
    });
    const rows: string[][] = [];
    const stalled = await executeCompanySheetsDeliveryJob(campaign.job.id, {
      ...deps(true, true),
      appendValues: async (input) => {
        rows.push(...input.values);
        return { ok: true as const };
      },
    });
    assert.equal(stalled.ok, false);
    if (!stalled.ok) assert.equal(stalled.code, "uncertain");
    assert.equal(rows.length, 0);
    const held = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: campaign.job.id } });
    assert.equal(held.status, "uncertain");
    assert.equal(held.uncertainReason, "worker_lost");
    const busy = await executeCompanySheetsDeliveryJob(sibling.job.id, {
      ...deps(true, true),
      appendValues: async (input) => {
        rows.push(...input.values);
        return { ok: true as const };
      },
    });
    assert.equal(busy.ok, false);
    if (!busy.ok) assert.equal(busy.code, "worksheet_busy");
    assert.equal(rows.length, 0);
    assert.equal(
      (await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: sibling.job.id } })).status,
      "queued"
    );

    const released = await releaseCompanySheetsDeliveryHold(
      campaign.job.id,
      COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
      deps(true, true)
    );
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "append_outcome_unresolved");
    const afterPhrase = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: campaign.job.id } });
    assert.equal(afterPhrase.status, "uncertain");
    assert.notEqual(afterPhrase.claimToken, "stale-worker");
    assert.ok(afterPhrase.appendStartedAt);
    const staleWrite = await db.companySheetsDeliveryJob.updateMany({
      where: { id: campaign.job.id, claimToken: "stale-worker" },
      data: { status: "succeeded", appendStartedAt: null },
    });
    assert.equal(staleWrite.count, 0);
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: [lead.id, secondLead.id] } } });
  });

  it("requires the admin key before tab setup and does not execute a create", async () => {
    const previous = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "tab-admin-key";
    const app = Fastify({ logger: false });
    const seen: string[] = [];
    try {
      await app.register(adminCompanySheetsDeliveryRoutes, {
        prefix: "/admin/v1",
        deps: {
          ...deps(true, true),
          fetchImpl: async (input, init) => {
            seen.push(`${init?.method ?? "GET"} ${String(input)}`);
            throw new Error("tab route test must not call Google");
          },
        },
      });
      const hidden = await app.inject({
        method: "POST",
        url: `/admin/v1/clients/${clientId}/google-sheets/tabs/create`,
        payload: { role: "campaign" },
      });
      assert.equal(hidden.statusCode, 401);
      assert.equal(seen.length, 0);
      const listed = await app.inject({
        method: "GET",
        url: `/admin/v1/clients/${clientId}/google-sheets/tabs`,
        headers: { "x-sa360-admin-key": "tab-admin-key" },
      });
      assert.equal(listed.statusCode, 200);
      assert.equal(listed.json().ok, true);
      assert.equal(seen.length, 0);
    } finally {
      if (previous == null) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previous;
      await app.close();
    }
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
