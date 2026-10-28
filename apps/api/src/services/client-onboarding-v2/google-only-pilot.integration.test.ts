/**
 * Local sa360_test proof that a separate exact-v3 spreadsheet can be approved
 * without changing the saved production binding. Google is an in-memory sheet.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient, type GoogleAccountConnectionStatus } from "@prisma/client";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA } from "../company-sheets-delivery/company-sheets-custom-row.js";
import { createOnboardingCapturedTestSheetsAppend } from "../company-sheets-delivery/onboarding-captured-test-append.js";
import type { CompanySheetsDeliveryDeps } from "../company-sheets-delivery/company-sheets-delivery.service.js";
import {
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  ONBOARDING_OPERATOR_OWNED_TEST_CLASS,
  isCapturedTestEnabled,
  runCapturedTestDelivery,
} from "./captured-test-delivery.js";
import { createPrismaCapturedTestStore } from "./onboarding-test-store.js";
import { approveExactV3TestWorksheet } from "./onboarding-config.service.js";
import { decideGoogleOnlyPilot, readGoogleOnlyPilotPreflight } from "./google-only-pilot-preflight.js";
import { loadCapturedTestWorld } from "./onboarding-world.js";
import {
  createOnboardingTestWorksheetHeaderReader,
  rereadOnboardingCapturedTestSheet,
} from "./onboarding-test-worksheet-reader.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);
const V3 = [...COMPANY_SHEETS_V3_HEADER];
const VET = ["Name", "Phone", "Email", "Age/ DOB", "Primary Reason", "City", "State", "Zip", "Notes", "Source", "Campaign", "Ad", "Date", "Status", "Owner"];
const EMAIL = "company-sheets@lifeagentlaunch.test";
const OPERATOR_EMAIL = "operator-owned@sa360.pilot";

class MemoryBook {
  rows: string[][] = [];
  appends: string[][][] = [];

  constructor(private readonly sheets: Record<string, { header: string[]; body: string[][] }>) {}

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const decoded = decodeURIComponent(url);
    if (decoded.includes("USER_ENTERED") || decoded.includes("/permissions") || decoded.includes("type=anyone")) {
      throw new Error(`refused Google call ${decoded}`);
    }
    const method = init?.method ?? "GET";
    if (method === "POST" && decoded.includes(":append")) {
      const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      for (const row of values) this.rows.push(row);
      return json(200, { updates: { updatedRange: "A2" } });
    }
    const title = titleOf(decoded);
    const grid = this.sheets[title] ?? { header: V3, body: [] };
    if (decoded.includes("A1:ZZ")) {
      const width = decoded.includes("A1:ZZ2") ? 2 : 1;
      return json(200, { values: [grid.header, ...grid.body, ...this.rows].slice(0, width) });
    }
    if (decoded.includes("!A2:AI")) {
      return json(200, { values: [...grid.body, ...this.rows] });
    }
    if (decoded.includes("valueRenderOption=FORMULA") && decoded.includes("!A1:")) {
      return json(200, { values: [grid.header, ...grid.body, ...this.rows] });
    }
    const column = decoded.match(/!([A-Z]+)1:\1/);
    if (column) {
      const index = columnIndex(column[1] ?? "A");
      return json(200, {
        values: [grid.header, ...grid.body, ...this.rows].map((row) => [row[index] ?? ""]),
      });
    }
    return json(200, { values: [] });
  }
}

function titleOf(decoded: string): string {
  const match = decoded.match(/'([^']+)'!/);
  return match?.[1]?.replaceAll("''", "'") ?? "";
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("google-only pilot local fixtures", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const clientId = `golot_${suffix}`;
  const productionSheet = `golotProd${suffix}`;
  const dirtySheet = `golotDirty${suffix}`;
  const testSheet = `golotTest${suffix}`;
  const books = new Map<string, MemoryBook>();
  let createdConnection = false;
  let previousConnectionStatus: GoogleAccountConnectionStatus | null = null;
  let companyEmail = EMAIL;
  let connectionId = "local";
  const ghlCalls: string[] = [];
  const operatorEventId = `evt_op_${suffix}`;
  const customerEventId = `evt_cu_${suffix}`;

  function book(id: string, sheets: Record<string, { header: string[]; body: string[][] }>): MemoryBook {
    let existing = books.get(id);
    if (!existing) {
      existing = new MemoryBook(sheets);
      books.set(id, existing);
    }
    return existing;
  }

  function sheetsFor(id: string): Record<string, { header: string[]; body: string[][] }> {
    if (id === productionSheet) {
      return {
        "VET Web Form": { header: VET, body: [["Kept Person"]] },
        "Campaign Leads": { header: V3, body: [["existing-customer-row"]] },
        "Empty v3 Same File": { header: V3, body: [] },
      };
    }
    if (id === dirtySheet) return { "Dirty Test": { header: V3, body: [["occupied"]] } };
    return { "Onboarding Test Leads": { header: V3, body: [] } };
  }

  function flags(captured: boolean): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SA360_CLIENT_ONBOARDING_V2_READ_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
    };
    delete env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED;
    delete env.SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED;
    delete env.SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED;
    delete env.SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED;
    if (captured) {
      env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED = "true";
      env.SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED = "true";
    }
    return env;
  }

  function deps(env: NodeJS.ProcessEnv): CompanySheetsDeliveryDeps {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const match = url.match(/spreadsheets\/([^/]+)/);
      const id = match?.[1] ? decodeURIComponent(match[1]) : "";
      if (id === productionSheet && (init?.method ?? "GET") === "POST") {
        throw new Error("production spreadsheet append refused");
      }
      return book(id, sheetsFor(id)).fetch(url, init);
    };
    return {
      env,
      db,
      now: () => new Date("2026-10-28T16:00:00.000Z"),
      fetchImpl,
      getAccessToken: async () => ({
        ok: true as const,
        accessToken: "ya29.google-only-pilot",
        connectionId,
        tokenVersion: 1,
        googleEmail: companyEmail,
      }),
      getMetadata: async (input: { spreadsheetId: string }) => ({
        ok: true as const,
        metadata: {
          spreadsheetId: input.spreadsheetId,
          title: input.spreadsheetId === productionSheet ? "Copy of FaceBook Lead Master - Alex Gross" : "SA360 Test Leads",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
          worksheets:
            input.spreadsheetId === productionSheet
              ? [
                  { sheetId: 15, title: "VET Web Form", index: 0, hidden: false, sheetType: "GRID" as const, rowCount: 1000, columnCount: 36 },
                  { sheetId: 3, title: "Campaign Leads", index: 1, hidden: false, sheetType: "GRID" as const, rowCount: 1000, columnCount: 36 },
                  { sheetId: 8, title: "Empty v3 Same File", index: 2, hidden: false, sheetType: "GRID" as const, rowCount: 1000, columnCount: 36 },
                ]
              : input.spreadsheetId === dirtySheet
                ? [{ sheetId: 1, title: "Dirty Test", index: 0, hidden: false, sheetType: "GRID" as const, rowCount: 1000, columnCount: 36 }]
                : [{ sheetId: 77, title: "Onboarding Test Leads", index: 0, hidden: false, sheetType: "GRID" as const, rowCount: 1000, columnCount: 36 }],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Pilot",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: [companyEmail],
          driveId: null,
          parents: [],
          capabilities: { canEdit: true, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
    };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrl);
    db = new PrismaClient({ datasources: { db: { url } } });
    const existing = await db.companyGoogleConnection.findUnique({ where: { connectionKey: "life_agent_launch" } });
    if (!existing) {
      createdConnection = true;
      await db.companyGoogleConnection.create({
        data: {
          connectionKey: "life_agent_launch",
          googleUserId: `golot-${suffix}`,
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
    } else {
      previousConnectionStatus = existing.status;
      if (existing.status !== "connected") {
        await db.companyGoogleConnection.update({
          where: { id: existing.id },
          data: { status: "connected", googleEmail: existing.googleEmail ?? EMAIL },
        });
      }
    }
    const connection = await db.companyGoogleConnection.findUniqueOrThrow({ where: { connectionKey: "life_agent_launch" } });
    connectionId = connection.id;
    companyEmail = connection.googleEmail?.trim() || EMAIL;
    if (!connection.googleEmail) {
      await db.companyGoogleConnection.update({ where: { id: connection.id }, data: { googleEmail: companyEmail } });
    }
    await db.clientAccount.create({
      data: { clientAccountId: clientId, clientDisplayName: "Google Only Fixture", status: "active" },
    });
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId: clientId,
        companyConnectionId: connection.id,
        spreadsheetId: productionSheet,
        spreadsheetTitle: "Copy of FaceBook Lead Master - Alex Gross",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${productionSheet}`,
        worksheetId: 15,
        worksheetTitle: "VET Web Form",
        controlBasis: "approved_shared_drive",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        canaryApproved: false,
        campaignDispatchEnabled: false,
        agedDispatchEnabled: false,
        campaignDispatchNotBefore: new Date("2026-10-01T00:00:00.000Z"),
        destinationRevision: 4,
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 15,
        worksheetTitle: "VET Web Form",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        headerContract: VET,
        boundAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    await db.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: clientId,
        email: OPERATOR_EMAIL,
        phoneE164: "+15551230000",
        requestId: randomUUID(),
        evidenceJson: { method: "operator_confirmed" },
      },
    });
    await db.sourceLeadEvent.create({
      data: {
        id: operatorEventId,
        sourceLeadUid: `uid_${operatorEventId}`,
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        sourceRouteKey: "operator_owned_test",
        clientAccountIdResolved: clientId,
        status: "received",
        rawPayloadJson: { operatorOwned: true },
        normalizedPayloadJson: {
          contact: { first_name: "Operator", last_name: "Owned", email: OPERATOR_EMAIL, phone_e164: "+15551230000", state: "VA" },
        },
        enrichmentMetadataJson: { recordClass: ONBOARDING_OPERATOR_OWNED_TEST_CLASS, inventoryTracked: false },
        receivedAt: new Date("2026-10-28T15:00:00.000Z"),
      },
    });
    await db.sourceLeadEvent.create({
      data: {
        id: customerEventId,
        sourceLeadUid: `uid_${customerEventId}`,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "lead_form",
        sourceRouteKey: "leadcapture_form",
        clientAccountIdResolved: clientId,
        status: "received",
        rawPayloadJson: { customer: true },
        normalizedPayloadJson: { contact: { email: "customer@example.com", first_name: "Customer", last_name: "Lead" } },
        enrichmentMetadataJson: { recordClass: "campaign_lead" },
        receivedAt: new Date("2026-10-20T15:00:00.000Z"),
      },
    });
  });

  after(async () => {
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsWorksheetLock.deleteMany({
      where: { spreadsheetId: { in: [productionSheet, dirtySheet, testSheet] } },
    });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: clientId } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: clientId } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: [operatorEventId, customerEventId] } } });
    if (createdConnection) {
      const remaining = await db.companySheetsDestination.count({
        where: { companyConnection: { connectionKey: "life_agent_launch" } },
      });
      if (remaining === 0) {
        await db.companyGoogleConnection.deleteMany({ where: { connectionKey: "life_agent_launch" } });
      }
    } else if (previousConnectionStatus && previousConnectionStatus !== "connected") {
      await db.companyGoogleConnection.updateMany({
        where: { connectionKey: "life_agent_launch" },
        data: { status: previousConnectionStatus },
      });
    }
    await db.$disconnect();
  });

  it("approves only a separate empty exact-v3 spreadsheet and leaves the production binding unchanged", async () => {
    const env = flags(false);
    const reader = createOnboardingTestWorksheetHeaderReader(deps(env));
    const populated = await approveExactV3TestWorksheet(
      { clientAccountId: clientId, requestId: randomUUID(), spreadsheetId: productionSheet, worksheetId: 3 },
      reader,
      db
    );
    assert.equal(populated.ok, false);
    if (populated.ok) return;
    assert.equal(populated.error, "test_worksheet_not_approved");
    const sameFile = await approveExactV3TestWorksheet(
      { clientAccountId: clientId, requestId: randomUUID(), spreadsheetId: productionSheet, worksheetId: 8 },
      reader,
      db
    );
    assert.equal(sameFile.ok, false);
    if (sameFile.ok) return;
    assert.match(sameFile.detail ?? "", /separate spreadsheet/);
    const dirty = await approveExactV3TestWorksheet(
      { clientAccountId: clientId, requestId: randomUUID(), spreadsheetId: dirtySheet, worksheetId: 1 },
      reader,
      db
    );
    assert.equal(dirty.ok, false);
    if (dirty.ok) return;
    assert.match(dirty.detail ?? "", /body must be empty/);
    const approved = await approveExactV3TestWorksheet(
      { clientAccountId: clientId, requestId: randomUUID(), spreadsheetId: testSheet, worksheetId: 77 },
      reader,
      db
    );
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.schemaVersion, COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId: clientId },
      include: { tabContracts: true },
    });
    assert.equal(destination.spreadsheetId, productionSheet);
    assert.equal(destination.worksheetTitle, "VET Web Form");
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.agedDispatchEnabled, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(destination.tabContracts[0]?.schemaVersion, COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA);
    assert.equal(destination.tabContracts[0]?.worksheetId, 15);
    const worksheet = await db.clientOnboardingTestWorksheet.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(worksheet.spreadsheetId, testSheet);
    assert.equal(worksheet.worksheetId, 77);
    assert.equal(book(productionSheet, sheetsFor(productionSheet)).appends.length, 0);
  });

  it("keeps delivery off until both exact flags, then appends once to the test spreadsheet only", async () => {
    const closed = flags(false);
    assert.equal(isCapturedTestEnabled(closed), false);
    const store = createPrismaCapturedTestStore(db);
    const closedPort = createOnboardingCapturedTestSheetsAppend(deps(closed));
    const closedWorld = await loadCapturedTestWorld(clientId, operatorEventId, db);
    const blocked = await runCapturedTestDelivery(
      {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        clientAccountId: clientId,
        sourceLeadEventId: operatorEventId,
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
      },
      closedWorld,
      {
        env: closed,
        store,
        sheets: closedPort,
        execution: "injected_fakes",
        rereadSheet: (sheet) => rereadOnboardingCapturedTestSheet(sheet, deps(closed)),
        ghlAggregate: { async deliver() { ghlCalls.push("closed"); throw new Error("ghl"); } },
      }
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.error, "captured_test_disabled");
    assert.equal(book(testSheet, sheetsFor(testSheet)).appends.length, 0);

    const open = flags(true);
    const port = createOnboardingCapturedTestSheetsAppend(deps(open));
    const world = await loadCapturedTestWorld(clientId, operatorEventId, db);
    const requestId = randomUUID();
    const sent = await runCapturedTestDelivery(
      {
        requestId,
        kind: "captured_event_delivery",
        clientAccountId: clientId,
        sourceLeadEventId: operatorEventId,
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
        actorLabel: "operator",
      },
      world,
      {
        env: open,
        store,
        sheets: port,
        execution: "injected_fakes",
        rereadSheet: (sheet) => rereadOnboardingCapturedTestSheet(sheet, deps(open)),
        ghlAggregate: { async deliver() { ghlCalls.push("open"); throw new Error("ghl"); } },
      }
    );
    assert.equal(sent.ok, true, sent.ok ? "" : `${sent.error} ${sent.detail ?? ""}`);
    if (!sent.ok) return;
    const testBook = book(testSheet, sheetsFor(testSheet));
    assert.equal(
      testBook.appends.length,
      1,
      JSON.stringify({ status: sent.run.status, attempts: sent.run.attempts, books: [...books.keys()] })
    );
    assert.equal(testBook.appends.length, 1);
    assert.equal(testBook.appends[0]?.[0]?.length, 35);
    assert.equal(testBook.appends[0]?.[0]?.[31]?.startsWith("onboarding-test:"), true);
    assert.equal(book(productionSheet, sheetsFor(productionSheet)).appends.length, 0);
    assert.equal(ghlCalls.length, 0);
    assert.equal(sent.externalCalls.providerWebhook, false);
    const duplicate = await runCapturedTestDelivery(
      {
        requestId,
        kind: "captured_event_delivery",
        clientAccountId: clientId,
        sourceLeadEventId: operatorEventId,
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
      },
      world,
      { env: open, store, sheets: port, execution: "injected_fakes" }
    );
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.duplicateRequest, true);
    assert.equal(testBook.appends.length, 1);
    const customerWorld = await loadCapturedTestWorld(clientId, customerEventId, db);
    const customerOnly = await runCapturedTestDelivery(
      {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        clientAccountId: clientId,
        sourceLeadEventId: customerEventId,
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
      },
      customerWorld,
      { env: open, store, sheets: port, execution: "injected_fakes", rereadSheet: (sheet) => rereadOnboardingCapturedTestSheet(sheet, deps(open)) }
    );
    assert.equal(customerOnly.ok, false);
    if (customerOnly.ok) return;
    assert.equal(customerOnly.error, "event_not_operator_owned");
    assert.equal(testBook.appends.length, 1);
    const customer = await runCapturedTestDelivery(
      {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        clientAccountId: clientId,
        sourceLeadEventId: customerEventId,
        destinations: ["google_sheets", "ghl_location_api"],
        execute: true,
        confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
        acknowledgeDownstreamAutomation: true,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
      },
      customerWorld,
      {
        env: open,
        store,
        sheets: port,
        execution: "injected_fakes",
        ghlAggregate: { async deliver() { ghlCalls.push("customer"); throw new Error("ghl"); } },
      }
    );
    assert.equal(customer.ok, false);
    if (customer.ok) return;
    assert.equal(customer.error, "google_only_pilot_required");
    assert.equal(testBook.appends.length, 1);
    assert.equal(ghlCalls.length, 0);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(destination.spreadsheetId, productionSheet);
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.agedDispatchEnabled, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: operatorEventId } }), 0);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: operatorEventId } }), 0);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: clientId } }), 0);
    const job = await db.companySheetsDeliveryJob.findFirstOrThrow({
      where: { clientAccountId: clientId, kind: "onboarding_captured_test" },
    });
    assert.equal(job.spreadsheetId, testSheet);
    assert.equal(job.idempotencyKey.startsWith("lead:"), false);
    assert.equal(job.idempotencyKey.startsWith("campaign:"), false);
    const preflight = await readGoogleOnlyPilotPreflight(clientId, db, 8_000);
    const decision = decideGoogleOnlyPilot(preflight);
    assert.equal(decision.append, "no_go");
    assert.equal(preflight.worksheet.state, "read");
    assert.equal(preflight.dispatch.state, "read");
    assert.ok(preflight.grants.state === "read" || preflight.grants.state === "unverified");
    if (preflight.grants.state === "unverified") {
      assert.match(preflight.grants.reason, /sa360_app/);
      assert.equal(decision.setup, "no_go");
    }
    if (preflight.dispatch.state === "read") {
      assert.equal(preflight.dispatch.value?.campaignDispatchEnabled, false);
      assert.equal(preflight.dispatch.value?.campaignWorksheetTitle, "VET Web Form");
    }
  });
});
