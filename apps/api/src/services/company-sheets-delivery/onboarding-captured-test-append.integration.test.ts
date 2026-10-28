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
const DELIVERY_INDEX = V3.indexOf("delivery_row_id");
const SOURCE_INDEX = V3.indexOf("source_lead_event_id");
const STABLE_COLUMN = onboardingCapturedTestStableColumn(V3);
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
  const names = ["ok", "header", "control", "timeout", "unknown", "drift", "cross", "other", "stats", "race", "probe", "reader"] as const;
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
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.rowsWritten, 1);
    assert.equal(sent.appended, true);
    const sheet = sheetFor(sheetId.ok);
    assert.equal(sheet.appends.length, 1);
    assert.equal(sheet.appends[0]?.[0]?.length, 35);
    assert.equal(sheet.appends[0]?.[0]?.[DELIVERY_INDEX], request.idempotencyKey);
    assert.equal(sheet.appends[0]?.[0]?.[SOURCE_INDEX], event.id);
    assert.equal(sheet.appendUrls[0]?.includes("valueInputOption=RAW"), true);
    assert.equal(sheet.appendUrls[0]?.includes("insertDataOption=INSERT_ROWS"), true);
    assert.equal(decodeURIComponent(sheet.appendUrls[0] ?? "").includes("Exact v3 Test"), true);
    assert.equal(decodeURIComponent(sheet.appendUrls[0] ?? "").includes("Campaign Leads"), false);
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: sent.jobId } });
    assert.equal(job.kind, "onboarding_captured_test");
    assert.equal(job.worksheetId, 7);
    assert.equal(job.sourceLeadEventId, event.id);
    assert.equal(job.idempotencyKey, request.idempotencyKey);
    assert.equal(job.idempotencyKey.startsWith("lead:"), false);
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
    assert.equal(replay.ok, true);
    assert.equal(sheet.appends.length, 1);
  });

  it("does not append a second row when the stable id is already on the worksheet", async () => {
    const event = await createLead(client.ok);
    const request = requestFor("ok", event.id, `runDup${suffix}`);
    const sheet = sheetFor(sheetId.ok);
    const seeded = [...request.values];
    sheet.rows.push(seeded);
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.appended, false);
    assert.equal(sheet.appends.length, 1);
    assert.equal(sheet.rows.filter((row) => row[DELIVERY_INDEX] === request.idempotencyKey).length, 1);
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
    assert.match(occupied.code, /is not empty/);
    assert.equal(occupied.externalCallExecuted, false);
    assert.equal(sheet.appends.length, beforeAppends);
  });

  it("blocks an invalid live header without appending or clearing a later retry", async () => {
    const event = await createLead(client.header);
    const sheet = sheetFor(sheetId.header);
    sheet.testHeader = [...V3];
    sheet.testHeader[0] = "Not Date";
    const sent = await appendOnboardingCapturedTestRow(requestFor("header", event.id, `runHeader${suffix}`), deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "header_mismatch");
    assert.equal(sent.externalCallExecuted, false);
    assert.equal(sheet.appends.length, 0);
    const job = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { clientAccountId: client.header } });
    assert.equal(job.status, "uncertain");
    assert.equal(job.appendStartedAt, null);
    const again = await appendOnboardingCapturedTestRow(requestFor("header", event.id, `runHeader2${suffix}`), deps());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "worksheet_blocked");
    assert.equal(sheet.appends.length, 0);
    assert.equal((await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } })).appendStartedAt, null);
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
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await db.companySheetsDeliveryJob.update({
      where: { id: prepared.job.id },
      data: { spreadsheetId: sheetId.other, clientAccountId: client.cross },
    });
    const executed = await executeCompanySheetsDeliveryJob(prepared.job.id, {
      ...deps(),
      controlledOnboardingCapturedTest: true,
    });
    assert.equal(executed.ok, false);
    assert.equal(sheetFor(sheetId.other).appends.length, 0);
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: prepared.job.id } });
    assert.equal(job.status, "uncertain");
    assert.equal(job.appendStartedAt, null);
  });

  it("does not append when company control fails", async () => {
    const event = await createLead(client.control);
    world.drive = "foreign";
    try {
      const sent = await appendOnboardingCapturedTestRow(requestFor("control", event.id, `runControl${suffix}`), deps());
      assert.equal(sent.ok, false);
      if (sent.ok) return;
      assert.equal(sent.code, "not_company_controlled");
      assert.equal(sent.externalCallExecuted, false);
      assert.equal(sheetFor(sheetId.control).appends.length, 0);
      const job = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { clientAccountId: client.control } });
      assert.equal(job.status, "retryable");
      assert.equal(job.appendStartedAt, null);
      const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.control } });
      assert.equal(destination.campaignDispatchEnabled, false);
    } finally {
      world.drive = "owned";
    }
  });

  it("holds an unknown timeout and does not append again", async () => {
    const event = await createLead(client.timeout);
    const sheet = sheetFor(sheetId.timeout);
    sheet.failAppend = "throw-before-write";
    const request = requestFor("timeout", event.id, `runTimeout${suffix}`);
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "uncertain");
    assert.equal(sent.uncertainReason, "timeout");
    assert.equal(sent.externalCallExecuted, true);
    assert.equal(sheet.appends.length, 1);
    assert.equal(sheet.rows.length, 0);
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: sent.jobId } });
    assert.ok(job.appendStartedAt);
    const lock = await db.companySheetsWorksheetLock.findUniqueOrThrow({
      where: { spreadsheetId_worksheetId: { spreadsheetId: sheetId.timeout, worksheetId: 7 } },
    });
    assert.equal(lock.ownerJobId, job.id);
    sheet.failAppend = null;
    const again = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "uncertain");
    assert.equal(sheet.appends.length, 1);
    const released = await releaseCompanySheetsDeliveryHold(job.id, COMPANY_SHEETS_RELEASE_HOLD_PHRASE, deps({ env: testEnv(true) }));
    assert.equal(released.ok, false);
    if (released.ok) return;
    assert.equal(released.code, "append_outcome_unresolved");
    const after = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.appendStartedAt?.toISOString(), job.appendStartedAt?.toISOString());
    assert.equal(after.status, "uncertain");
    const worldAfter = await loadCapturedTestWorld(client.timeout, event.id, db);
    assert.equal(worldAfter.sheets?.approvedTestWorksheetRisk?.uncertain, true);
  });

  it("keeps a single row when the append result cannot be reread", async () => {
    const event = await createLead(client.unknown);
    const sheet = sheetFor(sheetId.unknown);
    sheet.failAppend = "throw-after-write-blind";
    const request = requestFor("unknown", event.id, `runUnknown${suffix}`);
    const sent = await appendOnboardingCapturedTestRow(request, deps());
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "uncertain");
    assert.equal(sent.uncertainReason, "unknown");
    assert.equal(sheet.appends.length, 1);
    assert.equal(sheet.rows.filter((row) => row[DELIVERY_INDEX] === request.idempotencyKey).length, 1);
    sheet.failAppend = null;
    const again = await appendOnboardingCapturedTestRow(requestFor("unknown", event.id, `runUnknown2${suffix}`), deps());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "worksheet_blocked");
    assert.equal(sheet.appends.length, 1);
  });

  it("does not append after the approved worksheet revision changes", async () => {
    const event = await createLead(client.drift);
    const prepared = await enqueueOnboardingCapturedTestJob(requestFor("drift", event.id, `runDrift${suffix}`), deps());
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await db.clientOnboardingTestWorksheet.update({
      where: { clientAccountId: client.drift },
      data: { destinationRevision: 4 },
    });
    const executed = await executeCompanySheetsDeliveryJob(prepared.job.id, {
      ...deps(),
      controlledOnboardingCapturedTest: true,
    });
    assert.equal(executed.ok, false);
    if (executed.ok) return;
    assert.equal(executed.code, "onboarding_test_destination_changed");
    assert.equal(sheetFor(sheetId.drift).calls, 0);
    assert.equal(sheetFor(sheetId.drift).appends.length, 0);
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: prepared.job.id } });
    assert.equal(job.status, "uncertain");
    assert.equal(job.appendStartedAt, null);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.drift } });
    assert.equal(destination.worksheetId, 0);
    assert.equal(destination.campaignDispatchEnabled, false);
  });

  it("blocks a stats tab before any append", async () => {
    const event = await createLead(client.stats);
    world.stats = true;
    try {
      const sent = await appendOnboardingCapturedTestRow(requestFor("stats", event.id, `runStats${suffix}`), deps());
      assert.equal(sent.ok, false);
      if (sent.ok) return;
      assert.equal(sent.code, "test_worksheet_not_approved");
      assert.equal(sheetFor(sheetId.stats).appends.length, 0);
    } finally {
      world.stats = false;
    }
  });

  it("serializes two appends of the same key to one row", async () => {
    const event = await createLead(client.race);
    const sheet = sheetFor(sheetId.race);
    let release: () => void = () => undefined;
    sheet.holdAppend = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      sheet.onAppendEntered = resolve;
    });
    const request = requestFor("race", event.id, `runRace${suffix}`);
    const first = appendOnboardingCapturedTestRow(request, deps());
    await entered;
    const second = await appendOnboardingCapturedTestRow(request, deps());
    release();
    const winner = await first;
    assert.equal(winner.ok, true);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "uncertain");
    assert.equal(sheet.appends.length, 1);
    assert.equal(sheet.rows.filter((row) => row[DELIVERY_INDEX] === request.idempotencyKey).length, 1);
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
    const refusedEvent = await createLead(client.reader);
    const refused = await port.append(
      portRequest(requestFor("reader", refusedEvent.id, `portRefuse${suffix}`, { worksheetTitle: "Daily Stats" }))
    );
    assert.equal(refused.status, "failed");
    if (refused.status !== "failed") return;
    assert.equal(refused.externalCallExecuted, false);
    assert.equal(readerSheet.appends.length, readerBefore);

    const event = await createLead(client.reader);
    const seededRequest = requestFor("reader", event.id, `portSeed${suffix}`);
    readerSheet.rows.push([...seededRequest.values]);
    const seeded = await port.append(portRequest(seededRequest));
    assert.equal(seeded.status, "succeeded", seeded.status === "failed" ? seeded.error : seeded.status);
    if (seeded.status !== "succeeded") return;
    assert.equal(seeded.externalCallExecuted, false);

    readerSheet.rows = [];
    const createdRequest = requestFor("reader", event.id, `portNew${suffix}`);
    const created = await port.append(portRequest(createdRequest));
    assert.equal(created.status, "succeeded");
    if (created.status !== "succeeded") return;
    assert.equal(created.externalCallExecuted, true);
    assert.equal(created.rowsWritten, 1);
    const afterCreate = readerSheet.appends.length;
    const replay = await port.append(portRequest(createdRequest));
    assert.equal(replay.status, "succeeded");
    if (replay.status !== "succeeded") return;
    assert.equal(replay.externalCallExecuted, false);
    assert.equal(readerSheet.appends.length, afterCreate);

    readerSheet.rows = [];
    readerSheet.failAppend = "throw-before-write";
    const timeoutEvent = await createLead(client.reader);
    const timeoutRequest = requestFor("reader", timeoutEvent.id, `portTimeout${suffix}`);
    const timeout = await port.append(portRequest(timeoutRequest));
    assert.equal(timeout.status, "uncertain");
    if (timeout.status !== "uncertain") return;
    assert.equal(timeout.externalCallExecuted, true);
    assert.equal(timeout.reason, "timeout");
    assert.ok(timeout.appendStartedAt);
    const timeoutJob = await db.companySheetsDeliveryJob.findFirstOrThrow({
      where: { idempotencyKey: timeoutRequest.idempotencyKey },
    });
    assert.equal(timeoutJob.appendStartedAt?.toISOString(), timeout.appendStartedAt);
    const lock = await db.companySheetsWorksheetLock.findUniqueOrThrow({
      where: { spreadsheetId_worksheetId: { spreadsheetId: sheetId.reader, worksheetId: 7 } },
    });
    assert.equal(lock.ownerJobId, timeoutJob.id);
    const timeoutAgain = await port.append(portRequest(timeoutRequest));
    assert.equal(timeoutAgain.status, "uncertain");
    if (timeoutAgain.status !== "uncertain") return;
    assert.equal(timeoutAgain.externalCallExecuted, true);
    const timeoutHeld = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: timeoutJob.id } });
    assert.equal(timeoutHeld.status, "uncertain");
    assert.equal(timeoutHeld.appendStartedAt?.toISOString(), timeoutJob.appendStartedAt?.toISOString());

    const probeSheet = sheetFor(sheetId.probe);
    probeSheet.failAppend = "throw-after-write-blind";
    const unknownEvent = await createLead(client.probe);
    const unknownRequest = requestFor("probe", unknownEvent.id, `portUnknown${suffix}`);
    const unknown = await port.append(portRequest(unknownRequest));
    assert.equal(unknown.status, "uncertain");
    if (unknown.status !== "uncertain") return;
    assert.equal(unknown.reason, "unknown");
    assert.equal(unknown.externalCallExecuted, true);
    assert.ok(unknown.appendStartedAt);
    const unknownJob = await db.companySheetsDeliveryJob.findFirstOrThrow({
      where: { idempotencyKey: unknownRequest.idempotencyKey },
    });
    assert.equal(unknownJob.status, "uncertain");
    assert.equal(unknownJob.appendStartedAt?.toISOString(), unknown.appendStartedAt);
    probeSheet.failAppend = null;
    const unknownAgain = await port.append(portRequest(requestFor("probe", unknownEvent.id, `portUnknown2${suffix}`)));
    assert.equal(unknownAgain.status, "failed");
    if (unknownAgain.status !== "failed") return;
    assert.equal(unknownAgain.externalCallExecuted, false);
    assert.equal(unknownAgain.error, "worksheet_blocked");
  });
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
