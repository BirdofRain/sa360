/**
 * Local sa360_test coverage for automatic company Sheets dispatch. No live Google calls.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_EXECUTION_LEASE_MS } from "@sa360/shared";
import Fastify from "fastify";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_LEAD_HEADER,
  COMPANY_SHEETS_LEAD_HEADER_V2,
} from "../../lib/company-google-sheets-env.js";
import { companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminCompanySheetsDeliveryRoutes } from "../../routes/company-sheets-delivery.js";
import { sha256Hex } from "../ppl-fulfillment/buyer-csv-export.service.js";
import {
  executeCompanySheetsDeliveryJob,
  type CompanySheetsDeliveryDeps,
} from "../company-sheets-delivery/company-sheets-delivery.service.js";
import {
  recordCompanySheetsAgedIntent,
  recordCompanySheetsCampaignIntent,
} from "./company-sheets-dispatch-record.js";
import {
  getCompanySheetsDispatchStatus,
  processDueCompanySheetsDispatches,
  scheduleAgedReleaseExplicitly,
  setCompanySheetsDispatchActivation,
} from "./company-sheets-dispatch.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "dispatch@lifeagentlaunch.test";
const HEADER = "x-sa360-admin-key";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

class MemorySheet {
  rows: string[][] = [];
  appends: string[][][] = [];
  calls = 0;
  holdAppend: Promise<void> | null = null;
  onAppendEntered: (() => void) | null = null;

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls += 1;
    if (url.includes("USER_ENTERED") || url.includes("/permissions") || url.includes("type=anyone")) {
      throw new Error(`refused Google call ${url}`);
    }
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    if (method === "PUT") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      this.rows[0] = parsed.values?.[0] ?? [];
      return json(200, {});
    }
    if (method === "POST") {
      this.onAppendEntered?.();
      if (this.holdAppend) await this.holdAppend;
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      for (const row of values) this.rows.push(row);
      return json(200, {});
    }
    const decoded = decodeURIComponent(url);
    if (decoded.includes("A1:ZZ2")) return json(200, { values: this.rows.slice(0, 2) });
    if (decoded.includes("!A1:A")) return json(200, { values: this.rows.map((row) => [row[0] ?? ""]) });
    return json(200, { values: [] });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}`;
}

function csvDocument(rows: string[][]): string {
  return ["first_name,note", ...rows.map((row) => row.join(","))].join("\n") + "\n";
}

describe("company sheets automatic dispatch (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const client = {
    camp: `csd_camp_${suffix}`,
    aged: `csd_aged_${suffix}`,
    other: `csd_other_${suffix}`,
  };
  const sheetId = {
    camp: `sheetCamp${suffix}`,
    aged: `sheetAgedDispatch${suffix}`,
  };
  const sheets = new Map<string, MemorySheet>();
  const leadIds: string[] = [];
  const orderIds: string[] = [];
  let connectionId = "";

  function sheetFor(id: string): MemorySheet {
    let sheet = sheets.get(id);
    if (!sheet) {
      sheet = new MemorySheet();
      sheets.set(id, sheet);
    }
    return sheet;
  }

  function envFor(dispatch: boolean, execution: boolean): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: dispatch ? "true" : "false",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: execution ? "true" : "false",
    };
  }

  function deps(dispatch: boolean, execution: boolean): CompanySheetsDeliveryDeps {
    const env = envFor(dispatch, execution);
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const match = url.match(/spreadsheets\/([^/]+)/);
      const id = match?.[1] ? decodeURIComponent(match[1]) : "";
      return sheetFor(id).fetch(url, init);
    };
    return {
      env,
      db,
      now: () => new Date(),
      fetchImpl,
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.dispatch-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      }),
      getMetadata: async (input: { spreadsheetId: string }) => ({
        ok: true as const,
        metadata: {
          spreadsheetId: input.spreadsheetId,
          title: "Dispatch",
          spreadsheetUrl: sheetUrl(input.spreadsheetId),
          worksheets: [
            { sheetId: 0, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" },
            { sheetId: 1, title: "Aged Orders", index: 1, hidden: false, sheetType: "GRID" },
          ],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Dispatch",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: [EMAIL],
          driveId: null,
          parents: [],
          capabilities: { canEdit: true, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
    };
  }

  async function reset(clientAccountId: string, spreadsheetId: string) {
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId } });
    const sheet = sheetFor(spreadsheetId);
    sheet.rows = [];
    sheet.appends = [];
    sheet.calls = 0;
    sheet.holdAppend = null;
    sheet.onAppendEntered = null;
  }

  async function createLead(clientAccountId: string | null, status = "routing_matched", phone = "+15550102") {
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `uid_${suffix}_${leadIds.length}_${Math.random().toString(16).slice(2)}`,
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        rawPayloadJson: { untouched: true },
        clientAccountIdResolved: clientAccountId,
        status: status as "routing_matched",
        normalizedPayloadJson: {
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.com",
          phone,
        },
        enrichmentMetadataJson: { source: "dispatch-test" },
      },
    });
    leadIds.push(lead.id);
    return lead;
  }

  async function createOrder(
    clientAccountId: string,
    status: "draft" | "submitted" | "ready" | "active" | "paused" | "completed" | "canceled" = "active"
  ) {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-CSD-${suffix}-${orderIds.length}`,
        clientAccountId,
        status,
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 5,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
        submittedAt: new Date("2026-08-01T00:00:00.000Z"),
        activatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function createPackage(input: {
    clientAccountId: string;
    leadOrderId: string;
    rows?: string[][];
    sha?: string;
    rowCount?: number;
    releasedAt?: Date | null;
  }) {
    const rows = input.rows ?? [["Ada", "note"]];
    const csv = csvDocument(rows);
    const releasedAt = input.releasedAt ?? null;
    return db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: input.leadOrderId,
        clientAccountId: input.clientAccountId,
        rowCount: input.rowCount ?? rows.length,
        contentSha256: input.sha ?? sha256Hex(csv),
        idempotencyKey: `csd-pkg-${suffix}-${Math.random().toString(16).slice(2)}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: rows.map((_, index) => `alloc_${suffix}_${index}_${Math.random().toString(16).slice(2)}`),
        csvContent: csv,
        spreadsheetDeliveredAt: releasedAt,
        spreadsheetDeliveredBy: releasedAt ? "operator_alex" : null,
        spreadsheetDeliveryIdempotencyKey: releasedAt
          ? `csd-del-${suffix}-${Math.random().toString(16).slice(2)}`
          : null,
      },
    });
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: Object.values(client).map((clientAccountId) => ({
        clientAccountId,
        clientDisplayName: clientAccountId,
        status: "active",
      })),
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: "life_agent_launch",
        googleUserId: `company-dispatch-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes,
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    for (const name of ["camp", "aged"] as const) {
      const destination = await db.companySheetsDestination.create({
        data: {
          clientAccountId: client[name],
          companyConnectionId: connectionId,
          spreadsheetId: sheetId[name],
          spreadsheetTitle: name,
          spreadsheetUrl: sheetUrl(sheetId[name]),
          worksheetId: 0,
          worksheetTitle: "Leads",
          controlBasis: "drive_owner_verified",
          accessStatus: "readable",
          sharingStatus: "missing_recipient",
          enabled: false,
        },
      });
      await db.companySheetsTabContract.createMany({
        data: [
          {
            destinationId: destination.id,
            role: "campaign",
            setupState: "bound",
            worksheetId: 0,
            worksheetTitle: "Campaign Leads",
            schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
            headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
            boundAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          {
            destinationId: destination.id,
            role: "aged",
            setupState: "bound",
            worksheetId: 1,
            worksheetTitle: "Aged Orders",
            schemaVersion: "buyer_csv_v2",
            headerContract: ["delivery_row_id", "first_name", "note"],
            boundAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      });
    }
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup() {
    const ids = Object.values(client);
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsWorksheetLock.deleteMany({
      where: { spreadsheetId: { in: Object.values(sheetId) } },
    });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: "life_agent_launch" } });
    if (leadIds.length > 0) await db.sourceLeadEvent.deleteMany({ where: { id: { in: leadIds } } });
    if (orderIds.length > 0) {
      await db.leadDeliveryExportPackage.deleteMany({ where: { leadOrderId: { in: orderIds } } });
      await db.leadOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
  }

  it("leaves intake unchanged when dispatch is off, the client gate is off, or the lead is before the cutoff", async () => {
    await reset(client.camp, sheetId.camp);
    const lead = await createLead(client.camp);
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(false, false)
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: lead.id } }), 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);

    const activated = await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    assert.equal(activated.ok, true);
    if (!activated.ok) return;
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: client.camp } }), 0);
    const later = await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2020-01-01T00:00:00.000Z") }
    );
    assert.equal(later.ok, true);
    if (!later.ok) return;
    assert.equal(later.campaignDispatchNotBefore, activated.campaignDispatchNotBefore);

    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: lead.id } }), 0);

    const unmatched = await createLead(client.camp, "routing_unmatched");
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: unmatched.id,
        status: "routing_unmatched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: unmatched.id } }), 0);

    await setCompanySheetsDispatchActivation(client.camp, { campaignEnabled: false }, { db });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: lead.id } }), 0);
    const missing = await getCompanySheetsDispatchStatus(`missing_${suffix}`, { db, env: envFor(true, false) });
    assert.equal(missing.configured, false);
    assert.equal(missing.campaignDispatchEnabled, false);
    assert.equal(sheetFor(sheetId.camp).calls, 0);
  });

  it("schedules one post-cutoff campaign lead and appends it once when execution is on", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    const lead = await createLead(client.camp, "routing_matched", "+15550102");
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: lead.id } }), 1);

    const parked = await processDueCompanySheetsDispatches(deps(true, false));
    assert.equal(parked.executed, 0);
    assert.equal(sheetFor(sheetId.camp).appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    const queued = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(queued.status, "queued");

    const ran = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(ran.executed, 1);
    assert.equal(sheetFor(sheetId.camp).appends.length, 1);
    assert.equal(sheetFor(sheetId.camp).appends[0]?.[0]?.[6], "+15550102");
    const intent = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(intent.status, "completed");
    const again = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(again.processed, 0);
    assert.equal(sheetFor(sheetId.camp).appends.length, 1);

    await db.companySheetsDispatchIntent.update({
      where: { id: intent.id },
      data: { status: "scheduled", availableAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    const adopted = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(adopted.executed, 0);
    assert.equal(sheetFor(sheetId.camp).appends.length, 1);
    const finished = await db.companySheetsDispatchIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(finished.status, "completed");
  });

  it("keeps an in-flight append when the next drain overlaps, then does not append again", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    const lead = await createLead(client.camp, "routing_matched", "+15550108");
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const sheet = sheetFor(sheetId.camp);
    sheet.holdAppend = hold;
    sheet.onAppendEntered = () => entered();
    const first = processDueCompanySheetsDispatches(deps(true, true));
    try {
      await Promise.race([
        enteredPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("append did not start")), 5000)),
      ]);
      const running = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.equal(running.status, "running");
      assert.ok(running.appendStartedAt);
      const lock = await db.companySheetsWorksheetLock.findUnique({
        where: { spreadsheetId_worksheetId: { spreadsheetId: sheetId.camp, worksheetId: running.worksheetId } },
      });
      assert.equal(lock?.ownerJobId, running.id);
      const reserved = await db.companySheetsDispatchIntent.findFirstOrThrow({
        where: { sourceLeadEventId: lead.id },
      });
      assert.equal(reserved.status, "processing");
      const overlap = await processDueCompanySheetsDispatches(deps(true, true));
      assert.equal(overlap.processed, 0);
      assert.equal(overlap.executed, 0);
      assert.equal(overlap.stopReason, "execution_in_flight");
      assert.equal(sheet.appends.length, 0);
      const stillRunning = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: running.id } });
      assert.equal(stillRunning.status, "running");
      assert.equal(stillRunning.appendStartedAt?.toISOString(), running.appendStartedAt?.toISOString());
    } finally {
      release();
      sheet.holdAppend = null;
      sheet.onAppendEntered = null;
      await first;
    }
    const finished = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.attemptCount, 1);
    assert.equal(sheet.appends.length, 1);
    const replay = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(replay.processed, 0);
    assert.equal(replay.executed, 0);
    assert.equal(sheet.appends.length, 1);
    const released = await db.companySheetsWorksheetLock.findUnique({
      where: { spreadsheetId_worksheetId: { spreadsheetId: sheetId.camp, worksheetId: finished.worksheetId } },
    });
    assert.equal(released?.ownerJobId ?? null, null);
  });

  it("keeps a campaign lead awaiting setup until the tab is bound, then schedules it once", async () => {
    await reset(client.camp, sheetId.camp);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.camp } });
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: { setupState: "missing", worksheetId: null, boundAt: null, schemaVersion: null },
    });
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    const lead = await createLead(client.camp);
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    const waiting = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(waiting.status, "awaiting_setup");
    await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);
    assert.equal(sheetFor(sheetId.camp).calls, 0);

    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: {
        setupState: "bound",
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        boundAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await processDueCompanySheetsDispatches(deps(true, false));
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    assert.equal(sheetFor(sheetId.camp).appends.length, 0);
    await reset(client.camp, sheetId.camp);
  });

  it("writes both campaign authorities onto one v2 tab and keeps pending intents after the switch is off", async () => {
    await reset(client.camp, sheetId.camp);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.camp } });
    const original = await db.companySheetsTabContract.findUniqueOrThrow({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
    });
    try {
      await db.companySheetsTabContract.update({
        where: { id: original.id },
        data: {
          setupState: "bound",
          worksheetId: 0,
          worksheetTitle: "Campaign Leads",
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
          headerContract: [...COMPANY_SHEETS_LEAD_HEADER_V2],
          boundAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await setCompanySheetsDispatchActivation(
        client.camp,
        { campaignEnabled: true },
        { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
      );
      const rulePayload = {
        contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", phone_e164: "+15555550100", state: "TX" },
        lead_details: { consumer_age: "47", coverage_amount: "$50,000", niche: { branch_of_service: "Army" } },
        routing: {
          source_intake: {
            lead_id: "lc-rule-1",
            submitted_at: "2026-10-21T20:59:00.000Z",
            sourceAttributes: { age: "99", branch_of_service: "Navy", desired_coverage: "$100,000+", military_status: "Veteran" },
          },
        },
      };
      const pagePayload = {
        contact: { first_name: "Grace", last_name: "Hopper", email: "grace@example.com", phone_e164: "+15555550101", state: "VA" },
        lead_details: { beneficiary: "Spouse" },
        routing: {
          source_intake: {
            lead_id: "lc-page-9",
            submitted_at: "2026-10-21T20:10:00.000Z",
            sourceAttributes: { age: "64", desired_coverage: "$250,000", branch_of_service: "Navy", phone_verified: true },
            unmappedSourceFieldsJson: [{ key: "trustedformCaptureStatus", value: "captured" }],
          },
        },
      };
      async function make(payload: object, sourceLeadId: string) {
        const lead = await db.sourceLeadEvent.create({
          data: {
            sourceLeadUid: `uid_${suffix}_${sourceLeadId}`,
            sourceProvider: "leadcapture_io",
            sourceSystem: "leadcapture_io_legacy",
            sourceType: "webhook",
            sourceLeadId,
            rawPayloadJson: { untouched: true },
            clientAccountIdResolved: client.camp,
            status: "routing_matched",
            normalizedPayloadJson: payload,
          },
        });
        leadIds.push(lead.id);
        return lead;
      }
      const ruleLead = await make(rulePayload, "lc-rule-1");
      const pageLead = await make(pagePayload, "lc-page-9");
      for (const lead of [ruleLead, pageLead]) {
        await recordCompanySheetsCampaignIntent(
          {
            sourceLeadEventId: lead.id,
            status: "routing_matched",
            clientAccountId: client.camp,
            resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
          },
          db,
          envFor(true, false)
        );
      }
      const pending = await db.companySheetsDispatchIntent.findMany({
        where: { sourceLeadEventId: { in: [ruleLead.id, pageLead.id] } },
      });
      assert.equal(pending.length, 2);
      assert.deepEqual(pending.map((intent) => intent.status).sort(), ["pending", "pending"]);

      await setCompanySheetsDispatchActivation(client.camp, { campaignEnabled: false }, { db });
      const afterCutoff = await make(rulePayload, "lc-after-off");
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: afterCutoff.id,
          status: "routing_matched",
          clientAccountId: client.camp,
          resolvedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
        db,
        envFor(true, false)
      );
      assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: afterCutoff.id } }), 0);
      assert.equal(
        (await db.companySheetsDispatchIntent.findMany({ where: { sourceLeadEventId: { in: [ruleLead.id, pageLead.id] } } })).length,
        2
      );

      const firstDrain = await processDueCompanySheetsDispatches(deps(true, true));
      assert.equal(firstDrain.executed, 2);
      assert.equal(firstDrain.deferred, 0);
      assert.equal(firstDrain.stopReason, null);
      const sheet = sheetFor(sheetId.camp);
      assert.deepEqual(sheet.rows[0], [...COMPANY_SHEETS_LEAD_HEADER_V2]);
      const data = sheet.rows.slice(1);
      assert.equal(data.length, 2);
      for (const lead of [ruleLead, pageLead]) {
        const expected = companySheetsCampaignRowValues({
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
          stableRowId: `lead:${client.camp}:${lead.id}`,
          clientAccountId: client.camp,
          sourceLeadEventId: lead.id,
          receivedAt: lead.receivedAt.toISOString(),
          sourceLeadId: lead.sourceLeadId,
          normalizedPayload: lead.id === ruleLead.id ? rulePayload : pagePayload,
        });
        assert.ok(data.some((line) => JSON.stringify(line) === JSON.stringify(expected)));
      }
      assert.equal(data.some((line) => line.includes("203.0.113.50")), false);
    } finally {
      await db.companySheetsTabContract.update({
        where: { id: original.id },
        data: {
          setupState: original.setupState,
          worksheetId: original.worksheetId,
          worksheetTitle: original.worksheetTitle,
          schemaVersion: original.schemaVersion,
          headerContract: original.headerContract ?? [],
          boundAt: original.boundAt,
        },
      });
      await setCompanySheetsDispatchActivation(client.camp, { campaignEnabled: false }, { db });
      await reset(client.camp, sheetId.camp);
    }
  });

  it("executes a queued v1 snapshot after the live campaign contract changes", async () => {
    await reset(client.camp, sheetId.camp);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.camp } });
    const original = await db.companySheetsTabContract.findUniqueOrThrow({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
    });
    try {
      await db.companySheetsTabContract.update({
        where: { id: original.id },
        data: {
          setupState: "bound",
          worksheetId: 0,
          worksheetTitle: "Campaign Leads",
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
          headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
          boundAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await setCompanySheetsDispatchActivation(
        client.camp,
        { campaignEnabled: true },
        { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
      );
      const lead = await createLead(client.camp, "routing_matched", "+15550177");
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: lead.id,
          status: "routing_matched",
          clientAccountId: client.camp,
          resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        db,
        envFor(true, false)
      );
      await processDueCompanySheetsDispatches(deps(true, false));
      const queued = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.equal(queued.status, "queued");
      assert.equal(queued.schemaVersion, COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION);
      const stored = await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: queued.id } });
      const snapshot = stored.valuesJson as string[];
      assert.equal(snapshot.length, 7);
      assert.equal(snapshot[6], "+15550177");

      await db.companySheetsTabContract.update({
        where: { id: original.id },
        data: {
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
          headerContract: [...COMPANY_SHEETS_LEAD_HEADER_V2],
        },
      });
      const executed = await executeCompanySheetsDeliveryJob(queued.id, deps(true, true));
      assert.equal(executed.ok, true);
      if (!executed.ok) return;
      assert.equal(executed.status, "succeeded");
      const sheet = sheetFor(sheetId.camp);
      assert.deepEqual(sheet.rows[0], [...COMPANY_SHEETS_LEAD_HEADER]);
      assert.deepEqual(sheet.rows[1], snapshot);
      const finished = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.id } });
      assert.equal(finished.schemaVersion, COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION);
      assert.equal(finished.headerContract instanceof Array ? finished.headerContract.length : 0, 7);
    } finally {
      await db.companySheetsTabContract.update({
        where: { id: original.id },
        data: {
          setupState: original.setupState,
          worksheetId: original.worksheetId,
          worksheetTitle: original.worksheetTitle,
          schemaVersion: original.schemaVersion,
          headerContract: original.headerContract ?? [],
          boundAt: original.boundAt,
        },
      });
      await setCompanySheetsDispatchActivation(client.camp, { campaignEnabled: false }, { db });
      await reset(client.camp, sheetId.camp);
    }
  });

  it("dispatches a client-released package and refuses an internal package", async () => {
    await reset(client.camp, sheetId.camp);
    await reset(client.aged, sheetId.aged);
    await setCompanySheetsDispatchActivation(
      client.aged,
      { agedEnabled: true },
      { db, now: () => new Date("2026-01-01T00:00:00.000Z") }
    );
    const hiddenOrder = await createOrder(client.aged, "active");
    const hidden = await createPackage({ clientAccountId: client.aged, leadOrderId: hiddenOrder.id });
    assert.equal(hidden.spreadsheetDeliveredAt, null);
    await recordCompanySheetsAgedIntent(
      {
        exportPackageId: hidden.id,
        clientAccountId: client.aged,
        leadOrderId: hiddenOrder.id,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, true)
    );
    await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: hidden.id } }), 0);
    const hiddenIntent = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { exportPackageId: hidden.id },
    });
    assert.equal(hiddenIntent.status, "needs_explicit_schedule");
    assert.equal(hiddenIntent.lastError, "package_not_released");
    const blockedSchedule = await scheduleAgedReleaseExplicitly(hidden.id, "sam", deps(true, true));
    assert.equal(blockedSchedule.ok, false);
    if (!blockedSchedule.ok) assert.equal(blockedSchedule.code, "package_not_released");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: hidden.id } }), 0);
    assert.equal(
      (await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: hidden.id } })).spreadsheetDeliveredAt,
      null
    );

    await reset(client.aged, sheetId.aged);
    const releasedAt = new Date("2026-08-20T15:00:00.000Z");
    const order = await createOrder(client.aged, "active");
    const pkg = await createPackage({ clientAccountId: client.aged, leadOrderId: order.id, releasedAt });
    await recordCompanySheetsAgedIntent(
      {
        exportPackageId: pkg.id,
        clientAccountId: client.aged,
        leadOrderId: order.id,
        createdAt: releasedAt,
      },
      db,
      envFor(true, false)
    );
    const intent = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { exportPackageId: pkg.id } });
    assert.equal(intent.status, "pending");
    const parked = await processDueCompanySheetsDispatches(deps(true, false));
    assert.equal(parked.executed, 0);
    assert.equal(sheetFor(sheetId.aged).appends.length, 0);
    const stored = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    assert.equal(stored.spreadsheetDeliveredAt?.toISOString(), releasedAt.toISOString());
    const job = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { exportPackageId: pkg.id } });
    assert.equal(job.spreadsheetId, sheetId.aged);
    assert.equal(job.worksheetId, 1);

    const ran = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(ran.executed, 1);
    assert.equal(sheetFor(sheetId.aged).appends.length, 1);
    assert.equal(sheetFor(sheetId.aged).appends[0]?.[0]?.[1], "Ada");
    assert.equal(
      (await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: pkg.id } })).spreadsheetDeliveredAt?.toISOString(),
      releasedAt.toISOString()
    );
    const replay = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(replay.processed, 0);
    assert.equal(sheetFor(sheetId.aged).appends.length, 1);

    for (const status of ["draft", "paused", "canceled", "submitted"] as const) {
      await reset(client.aged, sheetId.aged);
      const blockedOrder = await createOrder(client.aged, status);
      const blocked = await createPackage({ clientAccountId: client.aged, leadOrderId: blockedOrder.id });
      await recordCompanySheetsAgedIntent(
        {
          exportPackageId: blocked.id,
          clientAccountId: client.aged,
          leadOrderId: blockedOrder.id,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        db,
        envFor(true, true)
      );
      await processDueCompanySheetsDispatches(deps(true, true));
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: blocked.id } }), 0);
      const held = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { exportPackageId: blocked.id } });
      assert.equal(held.status, "needs_explicit_schedule");
      assert.equal(sheetFor(sheetId.aged).appends.length, 0);
    }

    await reset(client.aged, sheetId.aged);
    const foreignOrder = await createOrder(client.other, "active");
    const mismatched = await createPackage({ clientAccountId: client.aged, leadOrderId: foreignOrder.id });
    await recordCompanySheetsAgedIntent(
      {
        exportPackageId: mismatched.id,
        clientAccountId: client.aged,
        leadOrderId: foreignOrder.id,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, true)
    );
    await processDueCompanySheetsDispatches(deps(true, true));
    const mismatchIntent = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { exportPackageId: mismatched.id },
    });
    assert.equal(mismatchIntent.lastError, "order_client_mismatch");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: mismatched.id } }), 0);

    await reset(client.aged, sheetId.aged);
    const tamperedOrder = await createOrder(client.aged, "active");
    const tampered = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: tamperedOrder.id,
      sha: "not-the-csv-hash",
    });
    await recordCompanySheetsAgedIntent(
      {
        exportPackageId: tampered.id,
        clientAccountId: client.aged,
        leadOrderId: tamperedOrder.id,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, true)
    );
    await processDueCompanySheetsDispatches(deps(true, true));
    const tamperedIntent = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { exportPackageId: tampered.id },
    });
    assert.equal(tamperedIntent.lastError, "csv_integrity_mismatch");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: tampered.id } }), 0);
  });

  it("does not replay a release that preceded tab setup until an operator schedules it", async () => {
    await reset(client.aged, sheetId.aged);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.aged } });
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "aged" } },
      data: { setupState: "missing", worksheetId: null, boundAt: null },
    });
    await setCompanySheetsDispatchActivation(
      client.aged,
      { agedEnabled: true },
      { db, now: () => new Date("2026-01-01T00:00:00.000Z") }
    );
    const releasedAt = new Date("2026-08-20T15:00:00.000Z");
    const order = await createOrder(client.aged, "ready");
    const pkg = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Bea", "held"]],
      releasedAt,
    });
    await recordCompanySheetsAgedIntent(
      {
        exportPackageId: pkg.id,
        clientAccountId: client.aged,
        leadOrderId: order.id,
        createdAt: pkg.createdAt,
      },
      db,
      envFor(true, true)
    );
    const waiting = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { exportPackageId: pkg.id } });
    assert.equal(waiting.status, "needs_explicit_schedule");
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "aged" } },
      data: {
        setupState: "bound",
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        schemaVersion: "buyer_csv_v2",
        headerContract: ["delivery_row_id", "first_name", "note"],
        boundAt: new Date(),
      },
    });
    await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: pkg.id } }), 0);

    const blocked = await scheduleAgedReleaseExplicitly(pkg.id, "sam", deps(false, true));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "dispatch_disabled");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: pkg.id } }), 0);

    const scheduled = await scheduleAgedReleaseExplicitly(pkg.id, "sam", deps(true, false));
    assert.equal(scheduled.ok, true);
    if (!scheduled.ok) return;
    assert.equal(scheduled.executed, false);
    const repeat = await scheduleAgedReleaseExplicitly(pkg.id, "sam", deps(true, false));
    assert.equal(repeat.ok, true);
    if (!repeat.ok) return;
    assert.equal(repeat.jobId, scheduled.jobId);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: pkg.id } }), 1);
    const audited = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { exportPackageId: pkg.id } });
    assert.equal(audited.explicit, true);
    assert.equal(audited.actor, "sam");
    assert.equal(
      (await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: pkg.id } })).spreadsheetDeliveredAt?.toISOString(),
      releasedAt.toISOString()
    );
    assert.equal(sheetFor(sheetId.aged).appends.length, 0);

    await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(sheetFor(sheetId.aged).appends.length, 1);
    assert.equal(sheetFor(sheetId.aged).appends[0]?.[0]?.[1], "Bea");
    await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(sheetFor(sheetId.aged).appends.length, 1);
  });

  it("rolls a campaign update and an export package back when the intent write crashes", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-01-01T00:00:00.000Z") }
    );
    const lead = await createLead(client.camp, "routing_unmatched");
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.sourceLeadEvent.update({
          where: { id: lead.id },
          data: { status: "routing_matched", clientAccountIdResolved: client.camp, routedAt: new Date() },
        });
        await recordCompanySheetsCampaignIntent(
          {
            sourceLeadEventId: lead.id,
            status: "routing_matched",
            clientAccountId: client.camp,
            resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
          },
          tx,
          envFor(true, false)
        );
        throw new Error("crash_after_intent");
      })
    );
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(stored.status, "routing_unmatched");
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: lead.id } }), 0);

    await reset(client.aged, sheetId.aged);
    await setCompanySheetsDispatchActivation(
      client.aged,
      { agedEnabled: true },
      { db, now: () => new Date("2026-01-01T00:00:00.000Z") }
    );
    const order = await createOrder(client.aged, "completed");
    await assert.rejects(
      db.$transaction(async (tx) => {
        const pkg = await tx.leadDeliveryExportPackage.create({
          data: {
            leadOrderId: order.id,
            clientAccountId: client.aged,
            rowCount: 1,
            contentSha256: "abc",
            idempotencyKey: `csd-rollback-${suffix}`,
            fieldSchemaVersion: "buyer_csv_v2",
            allocationIdsJson: ["alloc"],
            csvContent: "first_name,note\nAda,note\n",
          },
        });
        await recordCompanySheetsAgedIntent(
          {
            exportPackageId: pkg.id,
            clientAccountId: client.aged,
            leadOrderId: order.id,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
          },
          tx,
          envFor(true, false)
        );
        throw new Error("crash_after_package");
      })
    );
    assert.equal(await db.leadDeliveryExportPackage.count({ where: { leadOrderId: order.id } }), 0);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { leadOrderId: order.id } }), 0);
  });

  it("returns a campaign intent to awaiting setup when the destination disappears", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-01-01T00:00:00.000Z") }
    );
    const lead = await createLead(client.camp);
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    const destination = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId: client.camp },
    });
    try {
      await db.companySheetsDestination.update({
        where: { id: destination.id },
        data: { clientAccountId: client.other },
      });
      await processDueCompanySheetsDispatches(deps(true, true));
      const held = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.equal(held.status, "awaiting_setup");
      assert.equal(held.lastError, "destination_not_configured");
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);
      assert.equal(sheetFor(sheetId.camp).appends.length, 0);
    } finally {
      await db.companySheetsDestination.update({
        where: { id: destination.id },
        data: { clientAccountId: client.camp },
      });
      await db.companySheetsDispatchIntent.deleteMany({ where: { sourceLeadEventId: lead.id } });
    }
  });

  it("does not append again when the lease ends while the first request is still open", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    const lead = await createLead(client.camp, "routing_matched", "+15550109");
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.camp,
        resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      db,
      envFor(true, false)
    );
    let nowMs = Date.now();
    const runningDeps = deps(true, true);
    runningDeps.now = () => new Date(nowMs);
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const sheet = sheetFor(sheetId.camp);
    sheet.holdAppend = hold;
    sheet.onAppendEntered = () => entered();
    const first = processDueCompanySheetsDispatches(runningDeps);
    try {
      await Promise.race([
        enteredPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("append did not start")), 5000)),
      ]);
      const running = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.ok(running.appendStartedAt);
      nowMs += COMPANY_SHEETS_EXECUTION_LEASE_MS + 60_000;
      const overlap = await processDueCompanySheetsDispatches(runningDeps);
      assert.equal(overlap.executed, 0);
      assert.equal(sheet.appends.length, 0);
      const quarantined = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: running.id } });
      assert.equal(quarantined.status, "uncertain");
      assert.equal(quarantined.uncertainReason, "worker_lost");
      assert.ok(quarantined.appendStartedAt);
      assert.equal(quarantined.attemptCount, 1);
      const lock = await db.companySheetsWorksheetLock.findUnique({
        where: { spreadsheetId_worksheetId: { spreadsheetId: sheetId.camp, worksheetId: running.worksheetId } },
      });
      assert.equal(lock?.ownerJobId, running.id);
    } finally {
      release();
      sheet.holdAppend = null;
      sheet.onAppendEntered = null;
      await first;
    }
    assert.equal(sheet.appends.length, 1);
    const finished = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(finished.status, "uncertain");
    assert.equal(finished.attemptCount, 1);
    assert.ok(finished.appendStartedAt);
    const replay = await processDueCompanySheetsDispatches(runningDeps);
    assert.equal(replay.executed, 0);
    assert.equal(sheet.appends.length, 1);
  });

  it("alternates an older aged release with newer campaign leads", async () => {
    await reset(client.camp, sheetId.camp);
    await reset(client.aged, sheetId.aged);
    await setCompanySheetsDispatchActivation(
      client.aged,
      { agedEnabled: true },
      { db, now: () => new Date("2026-01-01T00:00:00.000Z") }
    );
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    const agedDestination = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId: client.aged },
    });
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: agedDestination.id, role: "aged" } },
      data: {
        setupState: "bound",
        worksheetId: 1,
        worksheetTitle: "Aged Orders",
        schemaVersion: "buyer_csv_v2",
        headerContract: ["delivery_row_id", "first_name", "note"],
        boundAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const releasedAt = new Date("2026-08-20T15:00:00.000Z");
    const order = await createOrder(client.aged, "active");
    const pkg = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Ada", "aged-note"]],
      releasedAt,
    });
    await recordCompanySheetsAgedIntent(
      {
        exportPackageId: pkg.id,
        clientAccountId: client.aged,
        leadOrderId: order.id,
        createdAt: releasedAt,
      },
      db,
      envFor(true, false)
    );
    const firstLead = await createLead(client.camp, "routing_matched", "+15550121");
    const secondLead = await createLead(client.camp, "routing_matched", "+15550122");
    for (const lead of [firstLead, secondLead]) {
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: lead.id,
          status: "routing_matched",
          clientAccountId: client.camp,
          resolvedAt: new Date("2026-08-21T00:00:00.000Z"),
        },
        db,
        envFor(true, false)
      );
    }
    await db.companySheetsDeliveryJob.updateMany({ data: { kind: "aged_release" } });
    const sequence: string[] = [];
    sheetFor(sheetId.aged).onAppendEntered = () => sequence.push("aged");
    sheetFor(sheetId.camp).onAppendEntered = () => sequence.push("campaign");
    const drained = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(drained.stopReason, null);
    assert.equal(drained.executed, 3);
    assert.deepEqual(sequence, ["campaign", "aged", "campaign"]);
    assert.equal(sheetFor(sheetId.camp).appends.length, 2);
    assert.equal(sheetFor(sheetId.aged).appends.length, 1);
    assert.equal(sheetFor(sheetId.camp).appends[0]?.[0]?.[6], "+15550121");
    assert.equal(sheetFor(sheetId.aged).appends[0]?.[0]?.[1], "Ada");
  });

  it("stops claiming when the start budget is exhausted and still finishes the open append", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    for (const phone of ["+15550131", "+15550132", "+15550133"]) {
      const lead = await createLead(client.camp, "routing_matched", phone);
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: lead.id,
          status: "routing_matched",
          clientAccountId: client.camp,
          resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        db,
        envFor(true, false)
      );
    }
    let nowMs = Date.now();
    const budgetDeps = deps(true, true);
    budgetDeps.now = () => new Date(nowMs);
    const sheet = sheetFor(sheetId.camp);
    sheet.onAppendEntered = () => {
      nowMs += 5_000;
    };
    const drained = await processDueCompanySheetsDispatches(budgetDeps, 20, { drainBudgetMs: 5_000 });
    assert.equal(drained.executed, 1);
    assert.equal(drained.stopReason, "time_budget");
    assert.equal(drained.deferred, 2);
    assert.equal(sheet.appends.length, 1);
    const pending = await db.companySheetsDispatchIntent.count({
      where: { clientAccountId: client.camp, status: "pending" },
    });
    assert.equal(pending, 2);
  });

  it("delivers a campaign backlog in one drain while the start budget remains", async () => {
    await reset(client.camp, sheetId.camp);
    await setCompanySheetsDispatchActivation(
      client.camp,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    const phones = Array.from({ length: 8 }, (_, index) => `+1555014${index}`);
    for (const phone of phones) {
      const lead = await createLead(client.camp, "routing_matched", phone);
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: lead.id,
          status: "routing_matched",
          clientAccountId: client.camp,
          resolvedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        db,
        envFor(true, false)
      );
    }
    const drained = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(drained.executed, 8);
    assert.equal(drained.deferred, 0);
    assert.equal(drained.stopReason, null);
    const sheet = sheetFor(sheetId.camp);
    assert.equal(sheet.appends.length, 8);
    assert.deepEqual(
      sheet.appends.map((batch) => batch[0]?.[6]),
      phones
    );
    const completed = await db.companySheetsDispatchIntent.count({
      where: { clientAccountId: client.camp, status: "completed" },
    });
    assert.equal(completed, 8);
  });

  it("exposes activation and explicit schedule on admin routes without calling Google", async () => {
    await reset(client.camp, sheetId.camp);
    const previous = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "dispatch-test-admin-key";
    const app = Fastify({ logger: false });
    try {
      await app.register(adminCompanySheetsDeliveryRoutes, { prefix: "/admin/v1", deps: deps(true, false) });
      const denied = await app.inject({
        method: "POST",
        url: `/admin/v1/clients/${client.camp}/google-sheets/dispatch-activation`,
        payload: { campaignEnabled: true },
      });
      assert.equal(denied.statusCode, 401);
      const activated = await app.inject({
        method: "POST",
        url: `/admin/v1/clients/${client.camp}/google-sheets/dispatch-activation`,
        headers: { [HEADER]: "dispatch-test-admin-key" },
        payload: { campaignEnabled: true },
      });
      assert.equal(activated.statusCode, 200);
      assert.equal(activated.json().googleCalled, false);
      assert.equal(activated.json().campaignDispatchEnabled, true);
      const status = await app.inject({
        method: "GET",
        url: `/admin/v1/clients/${client.camp}/google-sheets/dispatch`,
        headers: { [HEADER]: "dispatch-test-admin-key" },
      });
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().configured, true);
      assert.equal(sheetFor(sheetId.camp).calls, 0);
      const drained = await app.inject({
        method: "POST",
        url: "/admin/v1/company-sheets/internal/process-dispatch",
        headers: { [HEADER]: "dispatch-test-admin-key" },
        payload: {},
      });
      assert.equal(drained.statusCode, 200);
      assert.equal(drained.json().ok, true);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previous;
    }
  });
});
