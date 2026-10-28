/**
 * Local sa360_test coverage for the onboarding exact-v3 append.
 * Google is mocked. No production spreadsheet is contacted.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import {
  COMPANY_SHEETS_CANARY_HEADER,
  COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
} from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { probeCompanySheetWritePermission } from "../company-google/company-sheets-setup.service.js";
import { CAPTURED_TEST_DELIVERY_CLASS, type SheetsAppendRequest } from "../client-onboarding-v2/captured-test-delivery.js";
import { loadCapturedTestWorld } from "../client-onboarding-v2/onboarding-world.js";
import { createOnboardingCapturedTestSheetsAppend } from "./onboarding-captured-test-append.js";
import { readExplicitOnboardingTestWorksheetHeader } from "../client-onboarding-v2/onboarding-test-worksheet-reader.js";
import { companySheetsCampaignRowValues } from "./company-sheets-campaign-row.js";
import {
  appendOnboardingCapturedTestRow,
  enqueueOnboardingCapturedTestJob,
  executeCompanySheetsDeliveryJob,
  onboardingCapturedTestStableColumn,
  releaseCompanySheetsDeliveryHold,
  type CompanySheetsDeliveryDeps,
  type OnboardingCapturedTestAppendRequest,
} from "./company-sheets-delivery.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "onboarding-sheets@lifeagentlaunch.test";
const V3 = [...COMPANY_SHEETS_V3_HEADER];
const STABLE_COLUMN = onboardingCapturedTestStableColumn(V3);
const ONE_SHOT = "DELIVER ONE GOOGLE SHEETS TEST ROW";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

class MemorySheet {
  rows: string[][] = [];
  testHeader = [...V3];
  campaignHeader = ["delivery_row_id", "client_account_id", "source_lead_event_id", "received_at"];
  appends: string[][][] = [];
  appendUrls: string[] = [];
  calls = 0;
  failAppend: "throw-before-write" | "throw-after-write-blind" | null = null;
  holdAppend: Promise<void> | null = null;
  onAppendEntered: (() => void) | null = null;
  failColumnAfterAppend = false;

  reset() {
    this.rows = [];
    this.testHeader = [...V3];
    this.appends = [];
    this.appendUrls = [];
    this.calls = 0;
    this.failAppend = null;
    this.holdAppend = null;
    this.onAppendEntered = null;
    this.failColumnAfterAppend = false;
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls += 1;
    if (url.includes("USER_ENTERED") || url.includes("/permissions") || url.includes("type=anyone")) {
      throw new Error(`refused Google call ${url}`);
    }
    const method = init?.method ?? "GET";
    const decoded = decodeURIComponent(url);
    if (method === "POST") {
      this.appendUrls.push(url);
      this.onAppendEntered?.();
      if (this.holdAppend) await this.holdAppend;
      const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      if (this.failAppend === "throw-before-write") throw new Error("timeout");
      for (const row of values) this.rows.push(row);
      if (this.failAppend === "throw-after-write-blind") {
        this.failColumnAfterAppend = true;
        throw new Error("timeout");
      }
      return json(200, {});
    }
    if (decoded.includes("valueRenderOption=FORMULA")) {
      return json(200, { values: [this.headerFor(decoded), ...this.rows] });
    }
    if (decoded.includes("A1:ZZ")) {
      const header = this.headerFor(decoded);
      const width = decoded.includes("A1:ZZ2") ? 2 : 1;
      return json(200, { values: [header, ...this.rows].slice(0, width) });
    }
    const column = decoded.match(/!([A-Z]+)1:\1/);
    if (column) {
      if (this.failColumnAfterAppend) {
        this.failColumnAfterAppend = false;
        throw new Error("timeout");
      }
      const index = columnIndex(column[1] ?? "A");
      const header = this.headerFor(decoded);
      return json(200, { values: [header, ...this.rows].map((row) => [row[index] ?? ""]) });
    }
    return json(200, { values: [] });
  }

  headerFor(decoded: string): string[] {
    return decoded.includes("Campaign Leads") ? this.campaignHeader : this.testHeader;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("onboarding exact-v3 captured test append", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const names = ["ok", "header", "control", "timeout", "unknown", "drift", "cross", "other", "stats", "race", "probe", "reader", "auth"] as const;
  const client: Record<(typeof names)[number], string> = {
    ok: `ong6465_ok_${suffix}`,
    header: `ong6465_header_${suffix}`,
    control: `ong6465_control_${suffix}`,
    timeout: `ong6465_timeout_${suffix}`,
    unknown: `ong6465_unknown_${suffix}`,
    drift: `ong6465_drift_${suffix}`,
    cross: `ong6465_cross_${suffix}`,
    other: `ong6465_other_${suffix}`,
    stats: `ong6465_stats_${suffix}`,
    race: `ong6465_race_${suffix}`,
    probe: `ong6465_probe_${suffix}`,
    reader: `ong6465_reader_${suffix}`,
    auth: `ong6465_auth_${suffix}`,
  };
  const sheetId: Record<(typeof names)[number], string> = {
    ok: `ongSheetOk${suffix}`,
    header: `ongSheetHeader${suffix}`,
    control: `ongSheetControl${suffix}`,
    timeout: `ongSheetTimeout${suffix}`,
    unknown: `ongSheetUnknown${suffix}`,
    drift: `ongSheetDrift${suffix}`,
    cross: `ongSheetCross${suffix}`,
    other: `ongSheetOther${suffix}`,
    stats: `ongSheetStats${suffix}`,
    race: `ongSheetRace${suffix}`,
    probe: `ongSheetProbe${suffix}`,
    reader: `ongSheetReader${suffix}`,
    auth: `ongSheetAuth${suffix}`,
  };
  const sheets = new Map<string, MemorySheet>();
  const leadIds: string[] = [];
  let connectionId = "";
  const world: { drive: "owned" | "foreign"; canEdit: boolean; stats: boolean } = {
    drive: "owned",
    canEdit: true,
    stats: false,
  };

  function sheetFor(id: string): MemorySheet {
    let sheet = sheets.get(id);
    if (!sheet) {
      sheet = new MemorySheet();
      sheets.set(id, sheet);
    }
    return sheet;
  }

  function testEnv(execution = false): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: execution ? "true" : "false",
      SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "true",
    };
  }

  function deps(overrides: Partial<CompanySheetsDeliveryDeps> = {}): CompanySheetsDeliveryDeps {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const match = url.match(/spreadsheets\/([^/]+)/);
      const id = match?.[1] ? decodeURIComponent(match[1]) : "";
      return sheetFor(id).fetch(url, init);
    };
    return {
      env: testEnv(false),
      db,
      now: () => new Date(),
      fetchImpl,
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.onboarding-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      }),
      getMetadata: async (input: { spreadsheetId: string }) => ({
        ok: true as const,
        metadata: {
          spreadsheetId: input.spreadsheetId,
          title: "Onboarding",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
          worksheets: [
            { sheetId: 0, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" as const, rowCount: 1000, columnCount: 35 },
            {
              sheetId: 7,
              title: world.stats ? "Daily Stats" : "Exact v3 Test",
              index: 1,
              hidden: false,
              sheetType: "GRID" as const,
              rowCount: 1000,
              columnCount: 35,
            },
          ],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Onboarding",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: world.drive !== "foreign",
          ownerEmails: world.drive === "foreign" ? ["other@example.com"] : [EMAIL],
          driveId: null,
          parents: [],
          capabilities: { canEdit: world.canEdit, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
      ...overrides,
    };
  }

  async function createLead(clientAccountId: string) {
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `uid_${suffix}_${leadIds.length}_${randomUUID()}`,
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        rawPayloadJson: { untouched: true },
        clientAccountIdResolved: clientAccountId,
        status: "approved",
        receivedAt: new Date("2026-10-01T12:00:00.000Z"),
        normalizedPayloadJson: {
          contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
          phone: "5550100",
        },
        enrichmentMetadataJson: { source: "onboarding-writer-test" },
      },
    });
    leadIds.push(lead.id);
    return lead;
  }

  function requestFor(
    name: (typeof names)[number],
    eventId: string,
    testRunId: string,
    overrides: Partial<OnboardingCapturedTestAppendRequest> = {}
  ): OnboardingCapturedTestAppendRequest {
    const idempotencyKey = `onboarding-test:${testRunId}:sheets`;
    const values = companySheetsCampaignRowValues({
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      stableRowId: idempotencyKey,
      clientAccountId: client[name],
      sourceLeadEventId: eventId,
      receivedAt: "2026-10-01T12:00:00.000Z",
      sourceLeadId: null,
      normalizedPayload: {
        contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
        phone: "5550100",
      },
    });
    if (!values || values.length !== 35) throw new Error("v3 row was not 35 cells");
    return {
      clientAccountId: client[name],
      spreadsheetId: sheetId[name],
      worksheetId: 7,
      worksheetTitle: "Exact v3 Test",
      worksheetRole: "campaign",
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      values,
      idempotencyKey,
      deliveryRowId: idempotencyKey,
      sourceLeadEventId: eventId,
      testRunId,
      ...overrides,
    };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    const ids = Object.values(client);
    await db.clientAccount.createMany({
      data: names.map((name) => ({
        clientAccountId: client[name],
        clientDisplayName: name,
        status: "active",
      })),
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: "life_agent_launch",
        googleUserId: `ong6465-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes,
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    for (const name of names) {
      await db.companySheetsDestination.create({
        data: {
          clientAccountId: client[name],
          companyConnectionId: connectionId,
          spreadsheetId: sheetId[name],
          spreadsheetTitle: name,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId[name]}`,
          worksheetId: 0,
          worksheetTitle: "Campaign Leads",
          controlBasis: "drive_owner_verified",
          accessStatus: "readable",
          sharingStatus: "missing_recipient",
          enabled: false,
          canaryApproved: false,
          destinationRevision: 3,
          campaignDispatchNotBefore: new Date("2026-10-20T00:00:00.000Z"),
        },
      });
      const destination = await db.companySheetsDestination.findUniqueOrThrow({
        where: { clientAccountId: client[name] },
      });
      await db.companySheetsTabContract.create({
        data: {
          destinationId: destination.id,
          role: "campaign",
          setupState: "bound",
          worksheetId: 0,
          worksheetTitle: "Campaign Leads",
          schemaVersion: "company_sheets_campaign_v1",
          headerContract: ["delivery_row_id", "client_account_id", "source_lead_event_id", "received_at"],
          boundAt: new Date(),
        },
      });
      await db.clientOnboardingTestWorksheet.create({
        data: {
          clientAccountId: client[name],
          spreadsheetId: sheetId[name],
          worksheetId: 7,
          worksheetTitle: "Exact v3 Test",
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
          header: V3,
          headerSha256: sha256(JSON.stringify(V3)),
          destinationRevision: 3,
          controlBasis: { establishControl: "drive_owner_verified", checkedAt: "2026-10-27T14:00:00.000Z" },
          approvedAt: new Date("2026-10-27T14:00:00.000Z"),
        },
      });
    }
    void ids;
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup() {
    const ids = Object.values(client);
    const spreadsheets = Object.values(sheetId);
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.clientOnboardingTestRun.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: { in: spreadsheets } } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: leadIds } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companyGoogleConnection.deleteMany({ where: { googleUserId: { startsWith: "ong6465-" } } });
  }

  it("appends one exact-v3 row to the approved worksheet and leaves production delivery alone", async () => {
    assert.equal(STABLE_COLUMN, "AF");
    const event = await createLead(client.ok);
    const beforeEvent = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: event.id } });
    const beforeIntents = await db.companySheetsDispatchIntent.count({ where: { clientAccountId: client.ok } });
    const beforeEvidence = await db.companySheetsOrderDeliveryEvidence.count({ where: { clientAccountId: client.ok } });
    const request = requestFor("ok", event.id, `runOk${suffix}`);
    const sheet = sheetFor(sheetId.ok);
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "test_run_not_reserved");
    assert.equal(sent.externalCallExecuted, false);
    assert.equal(sheet.calls, 0);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { idempotencyKey: request.idempotencyKey } }), 0);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.ok } });
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.agedDispatchEnabled, false);
    assert.equal(destination.enabled, false);
    assert.equal(destination.writeReadiness, "not_verified");
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), "2026-10-20T00:00:00.000Z");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.ok, kind: "lead" } }), 0);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: client.ok } }), beforeIntents);
    assert.equal(await db.companySheetsOrderDeliveryEvidence.count({ where: { clientAccountId: client.ok } }), beforeEvidence);
    const afterEvent = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(JSON.stringify(afterEvent.deliveryResultJson), JSON.stringify(beforeEvent.deliveryResultJson));
    assert.equal(afterEvent.receivedAt.toISOString(), beforeEvent.receivedAt.toISOString());
    const replay = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(replay.ok, false);
    if (replay.ok) return;
    assert.equal(replay.externalCallExecuted, false);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.ok, kind: "onboarding_captured_test" } }), 0);
  });

  it("does not append a second row when the stable id is already on the worksheet", async () => {
    const event = await createLead(client.ok);
    const request = requestFor("ok", event.id, `runDup${suffix}`);
    const sheet = sheetFor(sheetId.ok);
    const seeded = [...request.values];
    sheet.rows.push(seeded);
    const callsBefore = sheet.calls;
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, false);
    if (!sent.ok) assert.equal(sent.externalCallExecuted, false);
    assert.equal(sheet.calls, callsBefore);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { idempotencyKey: request.idempotencyKey } }), 0);
  });

  it("makes no Google call without the pilot flag and does not append into a body that changed after approval", async () => {
    const sheet = sheetFor(sheetId.ok);
    const beforeAppends = sheet.appends.length;
    const beforeCalls = sheet.calls;
    const closedEvent = await createLead(client.ok);
    const closedEnv = testEnv();
    delete closedEnv.SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED;
    const closed = await appendOnboardingCapturedTestRow(requestFor("ok", closedEvent.id, `runClosed${suffix}`), {
      ...deps(),
      env: closedEnv,
    });
    assert.equal(closed.ok, false);
    if (closed.ok) return;
    assert.equal(closed.code, "google_only_pilot_required");
    assert.equal(closed.externalCallExecuted, false);
    assert.equal(sheet.appends.length, beforeAppends);
    assert.equal(sheet.calls, beforeCalls);

    const event = await createLead(client.ok);
    const occupied = await appendOnboardingCapturedTestRow(requestFor("ok", event.id, `runOccupied${suffix}`), deps());
    assert.equal(occupied.ok, false);
    if (occupied.ok) return;
    assert.equal(occupied.code, "test_run_not_reserved");
    assert.equal(occupied.externalCallExecuted, false);
    assert.equal(sheet.calls, beforeCalls);
    assert.equal(sheet.appends.length, beforeAppends);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { idempotencyKey: `onboarding-test:runOccupied${suffix}:sheets` } }), 0);
  });

  it("blocks an invalid live header without appending or clearing a later retry", async () => {
    const event = await createLead(client.header);
    const sheet = sheetFor(sheetId.header);
    sheet.testHeader = [...V3];
    sheet.testHeader[0] = "Not Date";
    const sent = await appendOnboardingCapturedTestRow(requestFor("header", event.id, `runHeader${suffix}`), deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "test_run_not_reserved");
    assert.equal(sent.externalCallExecuted, false);
    assert.equal(sheet.calls, 0);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.header } }), 0);
    const again = await appendOnboardingCapturedTestRow(requestFor("header", event.id, `runHeader2${suffix}`), deps());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.externalCallExecuted, false);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.header } }), 0);
  });

  it("does not write a 35-cell row onto a Canary identity", async () => {
    const event = await createLead(client.header);
    const sent = await appendOnboardingCapturedTestRow(
      requestFor("header", event.id, `runCanary${suffix}`, {
        worksheetRole: "canary",
        schemaVersion: COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
        worksheetId: 2,
        worksheetTitle: "Canary",
        values: Array.from({ length: 35 }, () => "x"),
      }),
      deps()
    );
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "canary_schema_mismatch");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { idempotencyKey: `onboarding-test:runCanary${suffix}:sheets` } }), 0);
    assert.equal(sheetFor(sheetId.header).appends.length, 0);
    const four = await appendOnboardingCapturedTestRow(
      requestFor("header", event.id, `runCanary4${suffix}`, {
        worksheetRole: "canary",
        schemaVersion: COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
        values: [...COMPANY_SHEETS_CANARY_HEADER],
      }),
      deps()
    );
    assert.equal(four.ok, false);
    if (four.ok) return;
    assert.equal(four.code, "canary_projection_not_a_v3_proof");
  });

  it("refuses another client's spreadsheet and does not substitute the saved campaign tab", async () => {
    const event = await createLead(client.other);
    const sent = await appendOnboardingCapturedTestRow(
      requestFor("other", event.id, `runCross${suffix}`, {
        spreadsheetId: sheetId.cross,
        worksheetId: 7,
        worksheetTitle: "Exact v3 Test",
      }),
      deps()
    );
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "test_worksheet_not_approved");
    assert.equal(sheetFor(sheetId.cross).appends.length, 0);
    assert.equal(sheetFor(sheetId.other).appends.length, 0);
    const own = await createLead(client.cross);
    const prepared = await enqueueOnboardingCapturedTestJob(requestFor("cross", own.id, `runOwn${suffix}`), deps());
    assert.equal(prepared.ok, false);
    if (prepared.ok) return;
    assert.equal(prepared.externalCallExecuted, false);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.cross } }), 0);
    const forged = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "onboarding_captured_test",
        status: "queued",
        clientAccountId: client.cross,
        companyConnectionId: connectionId,
        spreadsheetId: sheetId.cross,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId.cross}`,
        worksheetId: 7,
        worksheetTitle: "Exact v3 Test",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date(),
        headerContract: V3,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        destinationRevision: 3,
        sourceLeadEventId: own.id,
        idempotencyKey: `onboarding-test:runOwn${suffix}:sheets`,
        rowsTotal: 1,
      },
    });
    const executed = await executeCompanySheetsDeliveryJob(forged.id, {
      ...deps(),
      controlledOnboardingCapturedTest: true,
    });
    assert.equal(executed.ok, false);
    if (executed.ok) return;
    assert.equal(executed.code, "test_run_not_reserved");
    assert.equal(sheetFor(sheetId.cross).calls, 0);
    assert.equal(sheetFor(sheetId.other).appends.length, 0);
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: forged.id } });
    assert.equal(job.status, "queued");
    assert.equal(job.appendStartedAt, null);
  });

  it("does not append when company control fails", async () => {
    const event = await createLead(client.control);
    world.drive = "foreign";
    try {
      const sent = await appendOnboardingCapturedTestRow(requestFor("control", event.id, `runControl${suffix}`), deps());
      assert.equal(sent.ok, false);
      if (sent.ok) return;
      assert.equal(sent.code, "test_run_not_reserved");
      assert.equal(sent.externalCallExecuted, false);
      assert.equal(sheetFor(sheetId.control).calls, 0);
      assert.equal(sheetFor(sheetId.control).appends.length, 0);
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.control } }), 0);
      const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.control } });
      assert.equal(destination.campaignDispatchEnabled, false);
    } finally {
      world.drive = "owned";
    }
  });

  it("holds an unknown timeout and does not append again", async () => {
    const event = await createLead(client.timeout);
    const sheet = sheetFor(sheetId.timeout);
    const request = requestFor("timeout", event.id, `runTimeout${suffix}`);
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.externalCallExecuted, false);
    assert.equal(sheet.calls, 0);
    assert.equal(sheet.appends.length, 0);
    const started = new Date("2026-10-27T18:00:00.000Z");
    const job = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "onboarding_captured_test",
        status: "uncertain",
        clientAccountId: client.timeout,
        companyConnectionId: connectionId,
        spreadsheetId: sheetId.timeout,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId.timeout}`,
        worksheetId: 7,
        worksheetTitle: "Exact v3 Test",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date(),
        headerContract: V3,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        destinationRevision: 3,
        sourceLeadEventId: event.id,
        idempotencyKey: request.idempotencyKey,
        rowsTotal: 1,
        appendStartedAt: started,
        uncertainReason: "append_outcome_unknown",
      },
    });
    await db.companySheetsWorksheetLock.create({
      data: { spreadsheetId: sheetId.timeout, worksheetId: 7, ownerJobId: job.id, lockedAt: started },
    });
    const again = await executeCompanySheetsDeliveryJob(job.id, { ...deps(), controlledOnboardingCapturedTest: true });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "uncertain");
    assert.equal(sheet.calls, 0);
    const released = await releaseCompanySheetsDeliveryHold(job.id, COMPANY_SHEETS_RELEASE_HOLD_PHRASE, deps({ env: testEnv(true) }));
    assert.equal(released.ok, false);
    if (released.ok) return;
    assert.equal(released.code, "append_outcome_unresolved");
    const after = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.appendStartedAt?.toISOString(), started.toISOString());
    assert.equal(after.status, "uncertain");
    const lock = await db.companySheetsWorksheetLock.findUniqueOrThrow({
      where: { spreadsheetId_worksheetId: { spreadsheetId: sheetId.timeout, worksheetId: 7 } },
    });
    assert.equal(lock.ownerJobId, job.id);
    const worldAfter = await loadCapturedTestWorld(client.timeout, event.id, db);
    assert.equal(worldAfter.sheets?.approvedTestWorksheetRisk?.uncertain, true);
  });

  it("keeps a single row when the append result cannot be reread", async () => {
    const event = await createLead(client.unknown);
    const sheet = sheetFor(sheetId.unknown);
    const request = requestFor("unknown", event.id, `runUnknown${suffix}`);
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.externalCallExecuted, false);
    assert.equal(sheet.calls, 0);
    assert.equal(sheet.appends.length, 0);
    const again = await appendOnboardingCapturedTestRow(requestFor("unknown", event.id, `runUnknown2${suffix}`), deps());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.externalCallExecuted, false);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.unknown } }), 0);
  });

  it("does not append after the approved worksheet revision changes", async () => {
    const event = await createLead(client.drift);
    const prepared = await enqueueOnboardingCapturedTestJob(requestFor("drift", event.id, `runDrift${suffix}`), deps());
    assert.equal(prepared.ok, false);
    if (prepared.ok) return;
    assert.equal(prepared.code, "test_run_not_reserved");
    assert.equal(prepared.externalCallExecuted, false);
    assert.equal(sheetFor(sheetId.drift).calls, 0);
    assert.equal(sheetFor(sheetId.drift).appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.drift } }), 0);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.drift } });
    assert.equal(destination.worksheetId, 0);
    assert.equal(destination.campaignDispatchEnabled, false);
  });

  it("blocks a stats tab before any append", async () => {
    const event = await createLead(client.stats);
    const sheet = sheetFor(sheetId.stats);
    world.stats = true;
    try {
      const sent = await appendOnboardingCapturedTestRow(requestFor("stats", event.id, `runStats${suffix}`), deps());
      assert.equal(sent.ok, false);
      if (sent.ok) return;
      assert.equal(sent.code, "test_run_not_reserved");
      assert.equal(sent.externalCallExecuted, false);
      assert.equal(sheet.calls, 0);
      assert.equal(sheet.appends.length, 0);
      const titled = await appendOnboardingCapturedTestRow(
        requestFor("stats", event.id, `runStatsTitle${suffix}`, { worksheetTitle: "Daily Stats" }),
        deps()
      );
      assert.equal(titled.ok, false);
      if (titled.ok) return;
      assert.equal(titled.code, "test_worksheet_not_approved");
      assert.equal(titled.externalCallExecuted, false);
      assert.equal(sheet.calls, 0);
      assert.equal(sheet.appends.length, 0);
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.stats } }), 0);
    } finally {
      world.stats = false;
    }
  });

  it("serializes two appends of the same key to one row", async () => {
    const event = await createLead(client.race);
    const sheet = sheetFor(sheetId.race);
    const request = requestFor("race", event.id, `runRace${suffix}`);
    const [first, second] = await Promise.all([
      appendOnboardingCapturedTestRow(request, deps()),
      appendOnboardingCapturedTestRow(request, deps()),
    ]);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    if (first.ok || second.ok) return;
    assert.equal(first.externalCallExecuted, false);
    assert.equal(second.externalCallExecuted, false);
    assert.equal(sheet.calls, 0);
    assert.equal(sheet.appends.length, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { idempotencyKey: request.idempotencyKey } }), 0);
  });

  it("verifies write readiness only after canEdit is true on the bound campaign tab", async () => {
    world.canEdit = true;
    const verified = await probeCompanySheetWritePermission(
      client.probe,
      { spreadsheetId: sheetId.probe, worksheetId: 0 },
      deps()
    );
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.canEdit, true);
    assert.equal(verified.rowWritten, false);
    assert.equal(verified.matchesBoundCampaignTab, true);
    let destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.probe } });
    assert.equal(destination.writeReadiness, "verified");
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.enabled, false);
    const otherTab = await probeCompanySheetWritePermission(
      client.probe,
      { spreadsheetId: sheetId.probe, worksheetId: 7 },
      deps()
    );
    assert.equal(otherTab.ok, true);
    if (!otherTab.ok) return;
    assert.equal(otherTab.matchesBoundCampaignTab, false);
    destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.probe } });
    assert.equal(destination.writeReadiness, "verified");
    world.canEdit = false;
    try {
      const denied = await probeCompanySheetWritePermission(
        client.probe,
        { spreadsheetId: sheetId.probe, worksheetId: 0 },
        deps()
      );
      assert.equal(denied.ok, false);
      if (denied.ok) return;
      assert.equal(denied.code, "insufficient_capability");
      destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.probe } });
      assert.equal(destination.writeReadiness, "not_verified");
      assert.equal(destination.campaignDispatchEnabled, false);
    } finally {
      world.canEdit = true;
    }
  });

  it("reads only the explicitly chosen worksheet header", async () => {
    const missed = await readExplicitOnboardingTestWorksheetHeader(client.reader, null, deps());
    assert.equal(missed, null);
    const callsBefore = sheetFor(sheetId.reader).calls;
    const foreign = await readExplicitOnboardingTestWorksheetHeader(
      client.other,
      { spreadsheetId: sheetId.reader, worksheetId: 7 },
      deps()
    );
    assert.equal(foreign, null);
    assert.equal(sheetFor(sheetId.reader).calls, callsBefore);
    const chosen = await readExplicitOnboardingTestWorksheetHeader(
      client.reader,
      { spreadsheetId: sheetId.reader, worksheetId: 7 },
      deps()
    );
    assert.ok(chosen);
    assert.equal(chosen?.worksheetId, 7);
    assert.equal(chosen?.worksheetTitle, "Exact v3 Test");
    assert.equal(chosen?.header.length, 35);
    assert.equal(chosen?.header[0], "Date");
    assert.equal(chosen?.destinationRevision, 3);
    assert.equal(chosen?.control.establishControl, "drive_owner_verified");
    const production = await readExplicitOnboardingTestWorksheetHeader(
      client.reader,
      { spreadsheetId: sheetId.reader, worksheetId: 0 },
      deps()
    );
    assert.equal(production?.worksheetTitle, "Campaign Leads");
    assert.equal(production?.header.length, 4);
    assert.equal(production?.worksheetId, 0);
  });

  it("preserves the writer externalCallExecuted flag for new, idempotent, refused, and uncertain appends", async () => {
    const port = createOnboardingCapturedTestSheetsAppend(deps());
    const readerSheet = sheetFor(sheetId.reader);
    const readerBefore = readerSheet.appends.length;
    const callsBefore = readerSheet.calls;
    const refusedEvent = await createLead(client.reader);
    const refused = await port.append(
      portRequest(requestFor("reader", refusedEvent.id, `portRefuse${suffix}`, { worksheetTitle: "Daily Stats" }))
    );
    assert.equal(refused.status, "failed");
    if (refused.status !== "failed") return;
    assert.equal(refused.externalCallExecuted, false);
    assert.equal(readerSheet.appends.length, readerBefore);

    const event = await createLead(client.reader);
    const created = await port.append(portRequest(requestFor("reader", event.id, `portNew${suffix}`)));
    assert.equal(created.status, "failed");
    if (created.status !== "failed") return;
    assert.equal(created.externalCallExecuted, false);
    assert.equal(readerSheet.appends.length, readerBefore);
    assert.equal(readerSheet.calls, callsBefore);
    const replay = await port.append(portRequest(requestFor("reader", event.id, `portNew${suffix}`)));
    assert.equal(replay.status, "failed");
    if (replay.status !== "failed") return;
    assert.equal(replay.externalCallExecuted, false);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { idempotencyKey: `onboarding-test:portNew${suffix}:sheets` } }), 0);
  });

  it("refuses a caller-built append unless a persisted run survives the quarantine checks", async () => {
    const isolated = `ongSheetIsolated${suffix}`;
    await db.clientOnboardingTestWorksheet.update({
      where: { clientAccountId: client.auth },
      data: { spreadsheetId: isolated },
    });
    const event = await createLead(client.auth);
    const sheet = sheetFor(isolated);
    const production = sheetFor(sheetId.auth);
    const bare = requestFor("auth", event.id, `runBare${suffix}`, { spreadsheetId: isolated });
    const directAppend = await appendOnboardingCapturedTestRow(bare, deps());
    const directEnqueue = await enqueueOnboardingCapturedTestJob(
      requestFor("auth", event.id, `runEnqueue${suffix}`, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(directAppend.ok, false);
    assert.equal(directEnqueue.ok, false);
    if (directAppend.ok || directEnqueue.ok) return;
    assert.equal(directAppend.code, "test_run_not_reserved");
    assert.equal(directEnqueue.code, "test_run_not_reserved");
    assert.equal(directAppend.externalCallExecuted, false);
    assert.equal(directEnqueue.externalCallExecuted, false);

    const reservedId = `runReserved${suffix}`;
    await reserveExclusiveRun({
      id: reservedId,
      clientAccountId: client.auth,
      sourceLeadEventId: event.id,
      spreadsheetId: isolated,
    });
    const forged = await appendOnboardingCapturedTestRow(
      requestFor("auth", event.id, reservedId, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(forged.ok, false);
    if (forged.ok) return;
    assert.equal(forged.code, "quarantine_not_registered");
    assert.equal(forged.externalCallExecuted, false);
    const forgedJob = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "onboarding_captured_test",
        status: "queued",
        clientAccountId: client.auth,
        companyConnectionId: connectionId,
        spreadsheetId: isolated,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${isolated}`,
        worksheetId: 7,
        worksheetTitle: "Exact v3 Test",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date(),
        headerContract: V3,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        destinationRevision: 3,
        sourceLeadEventId: event.id,
        idempotencyKey: `onboarding-test:${reservedId}:sheets`,
        rowsTotal: 1,
      },
    });
    const executed = await executeCompanySheetsDeliveryJob(forgedJob.id, {
      ...deps(),
      controlledOnboardingCapturedTest: true,
    });
    assert.equal(executed.ok, false);
    if (executed.ok) return;
    assert.equal(executed.code, "quarantine_not_registered");
    const storedJob = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: forgedJob.id } });
    assert.equal(storedJob.status, "queued");
    assert.equal(storedJob.appendStartedAt, null);

    const mismatched = await enqueueOnboardingCapturedTestJob(
      requestFor("auth", event.id, `runMismatch${suffix}`, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(mismatched.ok, false);
    if (mismatched.ok) return;
    assert.equal(mismatched.code, "test_run_not_reserved");

    const foreignId = `runForeign${suffix}`;
    await reserveExclusiveRun({
      id: foreignId,
      clientAccountId: client.other,
      sourceLeadEventId: event.id,
      spreadsheetId: isolated,
    });
    const foreign = await appendOnboardingCapturedTestRow(
      requestFor("auth", event.id, foreignId, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.code, "tenant_mismatch");
    assert.equal(foreign.statusCode, 403);

    const movedId = `runMoved${suffix}`;
    await reserveExclusiveRun({
      id: movedId,
      clientAccountId: client.auth,
      sourceLeadEventId: event.id,
      spreadsheetId: sheetId.auth,
    });
    const moved = await enqueueOnboardingCapturedTestJob(
      requestFor("auth", event.id, movedId, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(moved.ok, false);
    if (moved.ok) return;
    assert.equal(moved.code, "test_worksheet_not_approved");

    const uncertainEvent = await createLead(client.auth);
    const uncertainCurrent = `runUncertainCurrent${suffix}`;
    await reserveExclusiveRun({
      id: `runUncertainPrior${suffix}`,
      clientAccountId: client.auth,
      sourceLeadEventId: uncertainEvent.id,
      spreadsheetId: isolated,
      status: "uncertain",
    });
    await reserveExclusiveRun({
      id: uncertainCurrent,
      clientAccountId: client.auth,
      sourceLeadEventId: uncertainEvent.id,
      spreadsheetId: isolated,
    });
    const uncertain = await enqueueOnboardingCapturedTestJob(
      requestFor("auth", uncertainEvent.id, uncertainCurrent, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(uncertain.ok, false);
    if (uncertain.ok) return;
    assert.equal(uncertain.code, "repeat_blocked_uncertain");

    const usedEvent = await createLead(client.auth);
    const usedCurrent = `runUsedCurrent${suffix}`;
    await reserveExclusiveRun({
      id: `runUsedPrior${suffix}`,
      clientAccountId: client.auth,
      sourceLeadEventId: usedEvent.id,
      spreadsheetId: isolated,
      status: "succeeded",
    });
    await reserveExclusiveRun({
      id: usedCurrent,
      clientAccountId: client.auth,
      sourceLeadEventId: usedEvent.id,
      spreadsheetId: isolated,
    });
    const used = await appendOnboardingCapturedTestRow(
      requestFor("auth", usedEvent.id, usedCurrent, { spreadsheetId: isolated }),
      deps()
    );
    assert.equal(used.ok, false);
    if (used.ok) return;
    assert.equal(used.code, "one_test_already_used");
    assert.equal(sheet.calls, 0);
    assert.equal(sheet.appends.length, 0);
    assert.equal(production.calls, 0);
    assert.equal(production.appends.length, 0);
    assert.equal(
      await db.companySheetsDeliveryJob.count({
        where: { clientAccountId: client.auth, kind: "onboarding_captured_test" },
      }),
      1
    );
  });

  async function reserveExclusiveRun(input: {
    id: string;
    clientAccountId: string;
    sourceLeadEventId: string;
    spreadsheetId: string;
    status?: string;
  }) {
    await db.clientOnboardingTestRun.create({
      data: {
        id: input.id,
        clientAccountId: input.clientAccountId,
        kind: "captured_event_delivery",
        sourceLeadEventId: input.sourceLeadEventId,
        destinations: ["google_sheets"],
        isolationMode: "isolated_destination",
        sheetsContract: "exact_v3_test_worksheet",
        requestId: `req_${input.id}`,
        status: input.status ?? "executing",
        warningCodes: [],
        requestSnapshot: {
          requestId: `req_${input.id}`,
          kind: "captured_event_delivery",
          fingerprint: `isolated|${ONE_SHOT}`,
          confirmation: ONE_SHOT,
          destinations: ["google_sheets"],
          isolationMode: "isolated_destination",
          sheetsContract: "exact_v3_test_worksheet",
          sheet: {
            spreadsheetId: input.spreadsheetId,
            worksheetId: 7,
            sheetsContract: "exact_v3_test_worksheet",
          },
        },
      },
    });
  }
});

function portRequest(request: OnboardingCapturedTestAppendRequest): SheetsAppendRequest {
  return {
    kind: "onboarding_captured_test",
    idempotencyKey: request.idempotencyKey,
    deliveryRowId: request.deliveryRowId,
    sourceLeadEventId: request.sourceLeadEventId,
    clientAccountId: request.clientAccountId,
    spreadsheetId: request.spreadsheetId,
    worksheetId: request.worksheetId,
    worksheetTitle: request.worksheetTitle,
    worksheetRole: request.worksheetRole,
    schemaVersion: request.schemaVersion,
    values: request.values,
    testRunId: request.testRunId,
    sa360DeliveryClass: CAPTURED_TEST_DELIVERY_CLASS,
  };
}
