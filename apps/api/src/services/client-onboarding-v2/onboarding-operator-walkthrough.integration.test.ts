/**
 * Mocked Alex Gross operator walkthrough.
 * Google and GHL are local fakes. No production host, credential, or client PII is used.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import Fastify from "fastify";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminClientOnboardingV2ConfigRoutes } from "../../routes/admin-client-onboarding-v2-config.js";
import type { CompanySheetsDeliveryDeps } from "../company-sheets-delivery/company-sheets-delivery.service.js";
import { createOnboardingCapturedTestSheetsAppend } from "../company-sheets-delivery/onboarding-captured-test-append.js";
import {
  CONFIRM_DELIVER,
  CONFIRM_REPEAT,
  runCapturedTestDelivery,
  type CapturedTestRequest,
} from "./captured-test-delivery.js";
import { capturedTestNoteBuilder } from "./onboarding-note-bridge.js";
import {
  ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG,
  ONBOARDING_GHL_TEST_GLOBAL_FLAG,
  createOnboardingGhlTestAdapter,
} from "./onboarding-ghl-test-adapter.js";
import { createPrismaCapturedTestStore } from "./onboarding-test-store.js";
import { rereadOnboardingCapturedTestSheet } from "./onboarding-test-worksheet-reader.js";
import { loadCapturedTestWorld } from "./onboarding-world.js";
import { readClientOnboardingSummary } from "./readiness.js";
import { listResolvedFolderSpreadsheets } from "./sheet-preview.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const V3 = [...COMPANY_SHEETS_V3_HEADER];
const HISTORICAL = ["delivery_row_id", "client_account_id", "source_lead_event_id", "received_at"];
const STATS = ["Date", "Leads"];
const EMAIL = "alex.gross.mock@example.invalid";
const PHONE = "+15555550123";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

class MemorySheet {
  appends: Array<{ title: string; values: string[][] }> = [];
  rows = new Map<string, string[][]>([
    ["Campaign Leads", []],
    ["Historical Leads", []],
    ["Daily Stats", []],
  ]);

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (url.includes("USER_ENTERED") || url.includes("/permissions") || url.includes("type=anyone") || url.includes("leadconnectorhq.com")) {
      throw new Error(`refused remote call ${url}`);
    }
    const method = init?.method ?? "GET";
    const decoded = decodeURIComponent(url);
    const title = titleFor(decoded);
    if (method === "POST") {
      const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push({ title, values });
      const existing = this.rows.get(title) ?? [];
      this.rows.set(title, [...existing, ...values]);
      return json(200, {});
    }
    if (decoded.includes("A1:ZZ")) {
      return json(200, { values: [headerFor(title), ...(this.rows.get(title) ?? [])].slice(0, decoded.includes("A1:ZZ2") ? 2 : 1) });
    }
    const column = decoded.match(/!([A-Z]+)1:\1/);
    if (column) {
      const index = columnIndex(column[1] ?? "A");
      const rows = [headerFor(title), ...(this.rows.get(title) ?? [])];
      return json(200, { values: rows.map((row) => [row[index] ?? ""]) });
    }
    return json(200, { values: [] });
  }
}

function titleFor(decoded: string): string {
  if (decoded.includes("Daily Stats")) return "Daily Stats";
  if (decoded.includes("Historical Leads")) return "Historical Leads";
  if (decoded.includes("Campaign Leads")) return "Campaign Leads";
  return "other";
}

function headerFor(title: string): string[] {
  if (title === "Daily Stats") return [...STATS];
  if (title === "Historical Leads") return [...HISTORICAL];
  if (title === "Campaign Leads") return [...V3];
  return ["a", "b", "c", "d"];
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

describe("mocked Alex Gross onboarding operator walkthrough", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientId = `alexmock_${suffix}`;
  const sheetId = `alexSheet${suffix}`;
  const sheet = new MemorySheet();
  let connectionId = "";
  let createdConnection = false;
  let googleEmail = "alex.mock.operator@example.invalid";
  let eventId = "";
  const ghlPosts: string[] = [];
  let ghlThrow = false;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.create({
      data: { clientAccountId: clientId, clientDisplayName: "Alex Gross Mock", status: "active" },
    });
    const existing = await db.companyGoogleConnection.findUnique({ where: { connectionKey: "life_agent_launch" } });
    if (existing) {
      connectionId = existing.id;
      googleEmail = existing.googleEmail ?? googleEmail;
    } else {
      const connection = await db.companyGoogleConnection.create({
        data: {
          connectionKey: "life_agent_launch",
          googleUserId: `alexmock-${suffix}`,
          googleEmail,
          status: "connected",
          scopes,
          tokenVersion: 1,
        },
      });
      connectionId = connection.id;
      createdConnection = true;
    }
    await db.companySheetsDestination.create({
      data: {
        clientAccountId: clientId,
        companyConnectionId: connectionId,
        spreadsheetId: sheetId,
        spreadsheetTitle: "Alex Gross Mock workbook",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}`,
        worksheetId: 7,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        canaryApproved: false,
        campaignDispatchEnabled: false,
        agedDispatchEnabled: false,
        destinationRevision: 3,
        campaignDispatchNotBefore: new Date("2026-10-20T00:00:00.000Z"),
      },
    });
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 7,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        headerContract: V3,
        boundAt: new Date("2026-10-27T14:00:00.000Z"),
      },
    });
    await db.clientOnboardingTestWorksheet.create({
      data: {
        clientAccountId: clientId,
        spreadsheetId: sheetId,
        worksheetId: 7,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header: V3,
        headerSha256: sha256(JSON.stringify(V3)),
        destinationRevision: 3,
        controlBasis: { establishControl: "drive_owner_verified", checkedAt: "2026-10-27T14:00:00.000Z" },
        approvedAt: new Date("2026-10-27T14:00:00.000Z"),
      },
    });
    await db.clientOnboardingDestinationProfile.create({
      data: {
        clientAccountId: clientId,
        ghlMode: "location_api",
        notesEnabled: true,
        sheetsSelected: true,
        notesContractVersion: "sa360_lead_note_v2",
      },
    });
    await db.clientGhlDestination.create({
      data: {
        clientAccountId: clientId,
        destinationSubaccountIdGhl: "locmockalex",
        destinationWorkflowIdGhl: "wfselecttz",
        workflowTriggerMode: "direct_api",
        deliveryEnabled: false,
        clientCutoverApproved: false,
      },
    });
    await db.ghlLocationConfigSnapshot.create({
      data: {
        locationId: "locmockalex",
        clientAccountId: clientId,
        fetchedAt: new Date("2026-10-27T14:00:00.000Z"),
        workflowsJson: [{ id: "wfselecttz", name: "Select Time Zone", status: "published" }],
      },
    });
    const funnel = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        parentUrlKey: `mock.example.invalid/alex-${suffix}`,
        pageSlug: "alex-mock",
        associationStatus: "confirmed",
        originClientAccountId: clientId,
      },
    });
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `alexmock_${suffix}`,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "lead_form",
        sourceRouteKey: funnel.parentUrlKey,
        clientAccountIdResolved: clientId,
        status: "routing_matched",
        receivedAt: new Date("2026-10-26T15:00:00.000Z"),
        rawPayloadJson: { fixture: "synthetic" },
        normalizedPayloadJson: {
          contact: {
            first_name: "Alex",
            last_name: "Mock",
            email: EMAIL,
            phone_e164: PHONE,
            state: "VA",
          },
          answerFields: [
            { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
            { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
          ],
        },
        routingResultJson: {
          matched: true,
          routingAuthority: "confirmed_source_association",
          sourceAssociation: { sourceFunnelId: funnel.id, matchedBy: "parent_url_key" },
        },
        enrichmentMetadataJson: { recordClass: "campaign_lead" },
        deliveryResultJson: { receipt: "unchanged" },
      },
    });
    eventId = lead.id;
    await db.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: clientId,
        email: EMAIL,
        phoneE164: PHONE,
        requestId: randomUUID(),
        actorLabel: "operator-mock",
        evidenceJson: { method: "fixture" },
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
    await db.clientOnboardingV2AuditEvent.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await db.clientOnboardingTestRun.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: sheetId } }).catch(() => undefined);
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await db.clientOnboardingVerifiedTestIdentity.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await db.ghlLocationConfigSnapshot.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await db.sourceLeadEvent.deleteMany({ where: { sourceLeadUid: `alexmock_${suffix}` } }).catch(() => undefined);
    await db.sourceFunnel.deleteMany({ where: { parentUrlKey: `mock.example.invalid/alex-${suffix}` } }).catch(() => undefined);
    await db.clientAccount.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    if (createdConnection) {
      await db.companyGoogleConnection.deleteMany({ where: { googleUserId: `alexmock-${suffix}` } }).catch(() => undefined);
    }
  }

  function sheetsDeps(): CompanySheetsDeliveryDeps {
    return {
      env: {
        ...process.env,
        SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
        SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "false",
        SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "false",
      },
      db,
      now: () => new Date("2026-10-27T15:00:00.000Z"),
      fetchImpl: async (input, init) => sheet.fetch(String(input), init),
      getAccessToken: async () => ({
        ok: true as const,
        accessToken: "ya29.alex-mock",
        connectionId,
        tokenVersion: 1,
        googleEmail,
      }),
      getMetadata: async () => ({
        ok: true as const,
        metadata: {
          spreadsheetId: sheetId,
          title: "Alex Gross Mock workbook",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}`,
          worksheets: [
            { sheetId: 4, title: "Historical Leads", index: 0, hidden: false, sheetType: "GRID" as const },
            { sheetId: 7, title: "Campaign Leads", index: 1, hidden: false, sheetType: "GRID" as const },
            { sheetId: 9, title: "Daily Stats", index: 2, hidden: false, sheetType: "GRID" as const },
          ],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Alex Gross Mock workbook",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: [googleEmail],
          driveId: null,
          parents: [],
          capabilities: { canEdit: true, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
    };
  }

  function deliveryEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_V2_READ_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "false",
      SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "false",
      [ONBOARDING_GHL_TEST_GLOBAL_FLAG]: "true",
      [ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG]: "true",
    };
  }

  function request(overrides: Partial<CapturedTestRequest> = {}): CapturedTestRequest {
    return {
      requestId: randomUUID(),
      kind: "captured_event_delivery",
      clientAccountId: clientId,
      sourceLeadEventId: eventId,
      destinations: ["google_sheets", "ghl_location_api"],
      execute: true,
      confirmation: CONFIRM_DELIVER,
      acknowledgeDownstreamAutomation: true,
      isolation: { mode: "verified_test_identity", sheetsContract: "exact_v3_test_worksheet" },
      noteOverflow: "refuse",
      actorLabel: "operator-mock",
      ...overrides,
    };
  }

  it("previews, delivers, and refuses an uncertain resend without production side effects", async () => {
    const summary = await readClientOnboardingSummary(clientId, db, deliveryEnv());
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.equal(summary.destinationProfile.present, true);
    assert.equal(summary.destinationProfile.revision, 1);
    assert.equal(summary.runtime.clientStatus, "active");
    assert.equal(summary.runtime.capturedTestEnabled, true);
    assert.equal(summary.runtime.ghlLocationTestAdapterApproved, true);
    assert.equal(summary.runtime.ghlProductionHostAllowed, false);
    assert.equal(summary.runtime.activationEnabled, false);
    assert.equal(summary.runtime.companySheetsExecutionEnabled, false);
    assert.equal(summary.sheets.campaignDispatchEnabled, false);
    assert.equal(summary.liveActivationPerformedByOnboarding, false);
    assert.equal(summary.sources.some((source) => source.sourceKind === "leadcapture" && source.proofs.linked.satisfied), true);

    const browsed = await listResolvedFolderSpreadsheets(clientId, "folderMockAlex", {
      ...sheetsDeps(),
      resolveFolder: async () => ({
        ok: true as const,
        folder: { folderId: "folderMockAlex", title: "Alex folder", driveId: null, basis: "my_drive_owner" as const },
      }),
      listFolderChildren: async () => ({
        ok: true as const,
        files: [
          {
            id: sheetId,
            name: "Alex Gross Mock workbook",
            mimeType: "application/vnd.google-apps.spreadsheet",
            ownedByMe: true,
            ownerEmails: [googleEmail],
            driveId: null,
            parents: ["folderMockAlex"],
            capabilities: { canEdit: true, canAddChildren: null },
            trashed: false,
            shortcutTargetId: null,
          },
        ],
        nextPageToken: null,
        skipped: 0,
      }),
    });
    assert.equal(browsed.ok, true);
    if (!browsed.ok) return;
    assert.equal(browsed.saved, false);
    assert.equal(browsed.linked, false);
    assert.equal(browsed.spreadsheets[0]?.spreadsheetId, sheetId);
    assert.equal(await db.companySheetsClientFolder.count({ where: { clientAccountId: clientId } }), 0);

    const world = await loadCapturedTestWorld(clientId, eventId, db);
    assert.equal(world.ghl?.workflowName, "Select Time Zone");
    assert.equal(world.storedLead?.email, EMAIL);
    assert.equal(world.sheets?.approvedTestWorksheet?.worksheetId, 7);
    assert.equal(world.sheets?.campaign?.header.length, 35);

    const google = sheetsDeps();
    const deps = {
      env: deliveryEnv(),
      db,
      store: createPrismaCapturedTestStore(db),
      notes: capturedTestNoteBuilder(),
      sheets: createOnboardingCapturedTestSheetsAppend(google),
      ghlAggregate: createOnboardingGhlTestAdapter({
        env: deliveryEnv(),
        apiBaseUrl: "https://127.0.0.1:9",
        resolveAuth: async () => ({ token: "injected-loopback-token" }),
        fetch: async (input, init) => {
          const url = String(input);
          assert.equal(url.startsWith("https://127.0.0.1:9"), true);
          ghlPosts.push(`${init?.method ?? "GET"} ${url}`);
          if (ghlThrow) throw new Error("socket closed");
          if (url.endsWith("/contacts/upsert")) return new Response(JSON.stringify({ contact: { id: "contactmock1" } }), { status: 200 });
          if (url.endsWith("/notes")) return new Response(JSON.stringify({ note: { id: "notemock1" } }), { status: 200 });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      }),
      execution: "injected_fakes" as const,
      rereadSheet: (planned: { spreadsheetId: string; worksheetId: number; ownerClientAccountId: string }) =>
        rereadOnboardingCapturedTestSheet(planned, google),
    };

    const preview = await runCapturedTestDelivery(
      request({ kind: "captured_event_replay", execute: false, requestId: randomUUID() }),
      world,
      deps
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    const previewJson = preview.run.previewJson as {
      sheet?: { values?: string[]; header?: string[]; worksheetTitle?: string };
      noteBody?: string;
      qaEvidence?: { status?: string; fullQaCompletenessAsserted?: boolean };
    };
    assert.equal(previewJson.sheet?.worksheetTitle, "Campaign Leads");
    assert.equal(previewJson.sheet?.header?.length, 35);
    assert.equal(previewJson.sheet?.values?.length, 35);
    assert.match(previewJson.noteBody ?? "", /Primary Reason/);
    assert.match(previewJson.noteBody ?? "", /Beneficiary/);
    assert.match(previewJson.noteBody ?? "", /SA360 test run:/);
    assert.equal(typeof previewJson.qaEvidence?.fullQaCompletenessAsserted, "boolean");
    assert.equal(sheet.appends.length, 0);
    assert.equal(ghlPosts.length, 0);

    const beforeEvent = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eventId } });
    const beforeInventory = await db.leadInventoryItem.count({ where: { originClientAccountId: clientId } });
    const beforeBilling = await db.fulfillmentOutbox.count({ where: { sourceLeadEvent: { clientAccountIdResolved: clientId } } });
    const beforeIntents = await db.companySheetsDispatchIntent.count({ where: { clientAccountId: clientId } });
    const deliveryRequest = request();
    const sent = await runCapturedTestDelivery(deliveryRequest, world, deps);
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.run.status, "succeeded");
    assert.equal(sheet.appends.length, 1);
    assert.equal(sheet.appends[0]?.title, "Campaign Leads");
    assert.equal(sheet.appends[0]?.values[0]?.length, 35);
    assert.equal(sheet.rows.get("Historical Leads")?.length, 0);
    assert.equal(sheet.rows.get("Daily Stats")?.length, 0);
    assert.equal(ghlPosts.length, 3);
    assert.equal(new Set(ghlPosts).size, 3);
    assert.equal(ghlPosts.some((url) => url.includes("leadconnectorhq.com")), false);
    const job = await db.companySheetsDeliveryJob.findFirstOrThrow({
      where: { clientAccountId: clientId, kind: "onboarding_captured_test" },
    });
    assert.equal(job.idempotencyKey, `onboarding-test:${sent.run.id}:sheets`);
    assert.equal(job.worksheetId, 7);
    assert.equal(job.sourceLeadEventId, eventId);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: clientId, kind: "lead" } }), 0);
    const attempts = await db.clientOnboardingTestAttempt.findMany({
      where: { testRunId: sent.run.id },
      include: { keys: true },
    });
    assert.equal(attempts.some((attempt) => attempt.destination === "google_sheets" && attempt.status === "succeeded"), true);
    const ghlAttempt = attempts.find((attempt) => attempt.destination === "ghl_location_api");
    assert.ok(ghlAttempt);
    assert.equal(ghlAttempt?.status, "succeeded");
    assert.equal(attempts.every((attempt) => attempt.downstreamExecuted === false), true);
    const keyValues = attempts.flatMap((attempt) => attempt.keys.map((key) => key.idempotencyKey));
    assert.ok(keyValues.includes(`onboarding-test:${sent.run.id}:ghl-contact`));
    assert.ok(keyValues.some((key) => key.startsWith(`onboarding-test:${sent.run.id}:ghl-note:`)));
    assert.ok(keyValues.includes(`onboarding-test:${sent.run.id}:ghl-workflow`));
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.agedDispatchEnabled, false);
    assert.equal(destination.enabled, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), "2026-10-20T00:00:00.000Z");
    const ghlDestination = await db.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(ghlDestination.deliveryEnabled, false);
    assert.equal(ghlDestination.clientCutoverApproved, false);
    const afterEvent = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eventId } });
    assert.equal(afterEvent.status, beforeEvent.status);
    assert.equal(JSON.stringify(afterEvent.deliveryResultJson), JSON.stringify(beforeEvent.deliveryResultJson));
    assert.equal(await db.leadInventoryItem.count({ where: { originClientAccountId: clientId } }), beforeInventory);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEvent: { clientAccountIdResolved: clientId } } }), beforeBilling);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: clientId } }), beforeIntents);
    assert.equal(await db.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientId } }), 1);

    const duplicate = await runCapturedTestDelivery(deliveryRequest, world, deps);
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.duplicateRequest, true);
    assert.equal(sheet.appends.length, 1);
    assert.equal(ghlPosts.length, 3);

    ghlThrow = true;
    const uncertain = await runCapturedTestDelivery(
      request({
        destinations: ["ghl_location_api"],
        confirmation: CONFIRM_REPEAT,
        repeatOfTestRunId: sent.run.id,
      }),
      world,
      deps
    );
    assert.equal(uncertain.ok, true);
    if (!uncertain.ok) return;
    assert.equal(uncertain.run.status, "uncertain");
    assert.equal(ghlPosts.length, 4);
    assert.equal(sheet.appends.length, 1);
    const blocked = await runCapturedTestDelivery(
      request({
        destinations: ["ghl_location_api"],
        confirmation: CONFIRM_REPEAT,
        repeatOfTestRunId: uncertain.run.id,
      }),
      world,
      deps
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.error, "repeat_blocked_uncertain");
    assert.equal(ghlPosts.length, 4);

    const previousKey = process.env.ADMIN_API_KEY;
    if (!previousKey && !process.env.SA360_ADMIN_KEY) process.env.ADMIN_API_KEY = "walkthrough-admin-key";
    try {
      const app = Fastify();
      await app.register(adminClientOnboardingV2ConfigRoutes, { prefix: "/admin/v1" });
      const response = await app.inject({
        method: "POST",
        url: `/admin/v1/clients/${clientId}/onboarding/activate`,
        headers: { "x-sa360-admin-key": process.env.ADMIN_API_KEY ?? process.env.SA360_ADMIN_KEY ?? "" },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error, "activation_disabled");
      assert.equal(response.json().liveActivationPerformedByOnboarding, false);
      await app.close();
    } finally {
      if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousKey;
    }
  });
});
