/**
 * Sheets writer consumes the saved campaign Lead Type snapshot.
 * Google calls stay on the in-memory sheet.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { PrismaClient } from "@prisma/client";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { previewColumnMapDraft } from "../client-onboarding-v2/column-maps.js";
import {
  enqueueConfirmedLeadSheetsDelivery,
  executeCompanySheetsDeliveryJob,
  type CompanySheetsDeliveryDeps,
} from "./company-sheets-delivery.service.js";
import { COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA, type ColumnAssignment } from "./company-sheets-custom-row.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PHONE = "+12025550147";
const PHONE_DISPLAY = "(202) 555-0147";
const CUSTOM_HEADER = ["Lead Type", "Phone", "State"];

function decision(status: "resolved" | "agreement" | "conflict" | "unresolved", key: string | null, label: string | null) {
  const classified = status === "resolved" || status === "agreement";
  return {
    version: 1,
    status,
    leadTypeKey: classified ? key : null,
    leadTypeLabel: classified ? label : null,
    binding: { kind: "confirmed_source_association", id: "sf", leadTypeKey: key },
    evidence: {
      trustedKey: null,
      trustedAdapter: null,
      bindingKey: key,
      bypassedSourceLeadTypeKey: null,
    },
  };
}

function payload(phone: string) {
  return {
    phone,
    contact: { first_name: "Ray", last_name: "Rodriguez", email: "ray@example.test", state: "Florida" },
    state: { lead_type: "NURSE" },
    routing: {
      product_type: "Final Expense",
      niche_key: "NURSE",
      source_intake: {
        parent_url_key: "go.lifeinsuranceforvets.com/learn-alex-gross",
        submitted_at: "2026-11-17T14:00:00.000Z",
      },
    },
    lead_details: { date_of_birth: "1979-04-12", consumer_age: "47" },
  };
}

class MemorySheet {
  rows: string[][] = [];
  appends: string[][][] = [];

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    if (method === "POST") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      for (const row of values) this.rows.push(row);
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    const decoded = decodeURIComponent(url);
    if (decoded.includes("A1:ZZ2")) {
      return new Response(JSON.stringify({ values: this.rows.slice(0, 2) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (decoded.includes("!A1:A")) {
      return new Response(JSON.stringify({ values: this.rows.map((row) => [row[0] ?? ""]) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ values: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
}

describe("Sheets campaign Lead Type delivery", { skip: !runIntegration, concurrency: 1 }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const v3Client = `slt_v3_${suffix}`;
  const customClient = `slt_custom_${suffix}`;
  const v3Sheet = `sltV3${suffix}`;
  const customSheet = `sltCustom${suffix}`;
  const sheet = new MemorySheet();
  const eventIds: string[] = [];
  let connectionId = "";
  let funnelId = "";
  let customMapId = "";

  function env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED: "true",
    };
  }

  function deps(): CompanySheetsDeliveryDeps {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes(customSheet)) throw new Error("custom sheet uses appendValues");
      return sheet.fetch(url, init);
    };
    return {
      env: env(),
      db,
      now: () => new Date(),
      fetchImpl,
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.lead-type-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: "sheets@lifeagentlaunch.test",
      }),
      getMetadata: async (input: { spreadsheetId: string }) => ({
        ok: true as const,
        metadata: {
          spreadsheetId: input.spreadsheetId,
          title: "Lead Type",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
          worksheets: [{ sheetId: input.spreadsheetId === customSheet ? 7 : 0, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" }],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Lead Type",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: ["sheets@lifeagentlaunch.test"],
          driveId: null,
          parents: [],
          capabilities: { canEdit: true, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
      getValues: async (input) => {
        if (input.spreadsheetId === v3Sheet) {
          return { ok: true as const, values: [sheet.rows[0] ?? [...COMPANY_SHEETS_V3_HEADER], sheet.rows[1] ?? []] };
        }
        return { ok: true as const, values: [CUSTOM_HEADER, []] };
      },
      appendValues: async (input) => {
        sheet.appends.push(input.values);
        return { ok: true as const, updatedRange: "'Campaign Leads'!A2" };
      },
      updateValues: async () => ({ ok: true as const, updatedRange: "'Campaign Leads'!A2" }),
    };
  }

  async function createEvent(input: {
    clientAccountId: string;
    phone: string;
    routingResultJson: unknown;
    email?: string;
  }) {
    const event = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `slt_${suffix}_${eventIds.length}`,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        rawPayloadJson: { untouched: true },
        clientAccountIdResolved: input.clientAccountId,
        status: "routing_matched",
        normalizedPayloadJson: {
          ...payload(input.phone),
          contact: {
            first_name: "Ray",
            last_name: "Rodriguez",
            email: input.email ?? `ray.${eventIds.length}.${suffix}@example.test`,
            state: "Florida",
          },
        },
        routingResultJson: input.routingResultJson as object,
        receivedAt: new Date("2026-11-17T15:00:00.000Z"),
      },
    });
    eventIds.push(event.id);
    return event;
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: v3Client, clientDisplayName: "Ray V3", status: "active" },
        { clientAccountId: customClient, clientDisplayName: "Ray Custom", status: "active" },
      ],
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: `slt-${suffix}`,
        googleUserId: `slt-${suffix}`,
        googleEmail: "sheets@lifeagentlaunch.test",
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
    const funnel = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        parentUrlKey: `go.lifeinsuranceforvets.com/learn-ray-${suffix}`,
        associationStatus: "confirmed",
        originClientAccountId: v3Client,
        leadTypeKey: "vet_web_form",
      },
    });
    funnelId = funnel.id;
    await seedDestination(v3Client, v3Sheet, 0, COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, [...COMPANY_SHEETS_V3_HEADER]);
    await seedDestination(customClient, customSheet, 7, COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA, CUSTOM_HEADER);
    const assignments: ColumnAssignment[] = CUSTOM_HEADER.map((sheetHeader, columnIndex) => {
      const sourceField = sheetHeader === "Lead Type" ? "lead_type" : sheetHeader === "Phone" ? "phone" : "state";
      return {
        sheetHeader,
        columnIndex,
        formula: false,
        decision: "mapped",
        explicit: true,
        transform: "passthrough",
        code: null,
        target: { kind: "v3_column", header: sheetHeader, sourceField },
      };
    });
    const map = await db.clientSheetColumnMap.create({
      data: {
        clientAccountId: customClient,
        sourceScope: "shared",
        spreadsheetId: customSheet,
        worksheetId: 7,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: CUSTOM_HEADER,
        assignments,
        revision: 1,
        publishedAt: new Date(),
      },
    });
    customMapId = map.id;
    sheet.rows = [[...COMPANY_SHEETS_V3_HEADER]];
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function seedDestination(
    clientAccountId: string,
    spreadsheetId: string,
    worksheetId: number,
    schemaVersion: string,
    header: string[]
  ) {
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connectionId,
        spreadsheetId,
        spreadsheetTitle: clientAccountId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        worksheetId,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        canaryApproved: false,
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId,
        worksheetTitle: "Campaign Leads",
        schemaVersion,
        headerContract: header,
        boundAt: new Date(),
      },
    });
  }

  async function cleanup() {
    const clients = [v3Client, customClient];
    await db.clientSheetsPersonAdmission.deleteMany({ where: { clientAccountId: { in: clients } } }).catch(() => undefined);
    await db.clientSheetsDedupeDecision.deleteMany({ where: { clientAccountId: { in: clients } } }).catch(() => undefined);
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: clients } } }).catch(() => undefined);
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: { in: [v3Sheet, customSheet] } } }).catch(() => undefined);
    await db.clientSheetColumnMap.deleteMany({ where: { clientAccountId: { in: clients } } }).catch(() => undefined);
    await db.companySheetsTabContract.deleteMany({ where: { destination: { clientAccountId: { in: clients } } } }).catch(() => undefined);
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: clients } } }).catch(() => undefined);
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: `slt-${suffix}` } }).catch(() => undefined);
    if (eventIds.length > 0) await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
    await db.sourceFunnelLeadTypeAudit.deleteMany({ where: { sourceFunnelId: funnelId } }).catch(() => undefined);
    await db.sourceFunnel.deleteMany({ where: { id: funnelId } }).catch(() => undefined);
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clients } } }).catch(() => undefined);
  }

  it("appends the saved label and formatted phone, and a retry keeps that row", async () => {
    const ray = await createEvent({
      clientAccountId: v3Client,
      phone: PHONE,
      routingResultJson: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        sourceAssociation: { sourceFunnelId: funnelId },
        campaignLeadType: decision("resolved", "vet_web_form", "Vet Web Form"),
      },
    });
    const queued = await enqueueConfirmedLeadSheetsDelivery(ray.id, deps());
    assert.equal(queued.ok, true, queued.ok ? "" : queued.code);
    if (!queued.ok) return;
    const stored = await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: queued.job.id } });
    const values = stored.valuesJson as string[];
    const leadType = values[COMPANY_SHEETS_V3_HEADER.indexOf("Lead Type")];
    const phone = values[COMPANY_SHEETS_V3_HEADER.indexOf("Phone")];
    const state = values[COMPANY_SHEETS_V3_HEADER.indexOf("State")];
    assert.equal(leadType, "Vet Web Form");
    assert.equal(phone, PHONE_DISPLAY);
    assert.equal(state, "Florida");

    await db.sourceFunnel.update({ where: { id: funnelId }, data: { leadTypeKey: "trucker_web_form" } });
    const retried = await enqueueConfirmedLeadSheetsDelivery(ray.id, deps());
    assert.equal(retried.ok, true);
    if (!retried.ok) return;
    assert.equal(retried.job.id, queued.job.id);
    assert.equal(retried.created, false);
    const again = await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: queued.job.id } });
    assert.equal((again.valuesJson as string[])[COMPANY_SHEETS_V3_HEADER.indexOf("Lead Type")], "Vet Web Form");

    const executed = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(executed.ok, true, executed.ok ? "" : executed.code);
    assert.ok(sheet.appends.some((batch) => batch.some((row) => row.includes("Vet Web Form") && row.includes(PHONE_DISPLAY))));
    const canonical = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: ray.id } });
    assert.equal((canonical.normalizedPayloadJson as { phone?: string }).phone, PHONE);
  });

  it("writes nurse and trucker labels for one client and does not hold a blank classification", async () => {
    const nurse = await createEvent({
      clientAccountId: customClient,
      phone: "+12025550148",
      email: `nurse.${suffix}@example.test`,
      routingResultJson: { campaignLeadType: decision("resolved", "nurse_web_form", "Nurse Web Form") },
    });
    const trucker = await createEvent({
      clientAccountId: customClient,
      phone: "+12025550149",
      email: `trucker.${suffix}@example.test`,
      routingResultJson: { campaignLeadType: decision("resolved", "trucker_web_form", "Trucker Web Form") },
    });
    const repeated = await createEvent({
      clientAccountId: customClient,
      phone: "+12025550148",
      email: `repeat.${suffix}@example.test`,
      routingResultJson: { campaignLeadType: decision("resolved", "trucker_web_form", "Trucker Web Form") },
    });
    const nurseJob = await enqueueConfirmedLeadSheetsDelivery(nurse.id, deps());
    const truckerJob = await enqueueConfirmedLeadSheetsDelivery(trucker.id, deps());
    assert.equal(nurseJob.ok, true, nurseJob.ok ? "" : nurseJob.code);
    assert.equal(truckerJob.ok, true, truckerJob.ok ? "" : truckerJob.code);
    if (!nurseJob.ok || !truckerJob.ok) return;
    const nurseValues = (await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: nurseJob.job.id } })).valuesJson as string[];
    const truckerValues = (await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: truckerJob.job.id } })).valuesJson as string[];
    assert.deepEqual(nurseValues, ["Nurse Web Form", "(202) 555-0148", "Florida"]);
    assert.deepEqual(truckerValues, ["Trucker Web Form", "(202) 555-0149", "Florida"]);

    const repeatJob = await enqueueConfirmedLeadSheetsDelivery(repeated.id, deps());
    if (repeatJob.ok) {
      const repeatValues = (await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: repeatJob.job.id } })).valuesJson as string[];
      assert.equal(repeatValues[0], "Trucker Web Form");
    } else {
      assert.notEqual(repeatJob.code, "campaign_lead_type_conflict");
      assert.notEqual(repeatJob.code, "campaign_lead_type_unresolved");
      assert.notEqual(repeatJob.code, "campaign_lead_type_malformed");
    }

    const conflict = await createEvent({
      clientAccountId: customClient,
      phone: "+12025550150",
      email: `conflict.${suffix}@example.test`,
      routingResultJson: { campaignLeadType: decision("conflict", "vet_web_form", null) },
    });
    const conflictJob = await enqueueConfirmedLeadSheetsDelivery(conflict.id, deps());
    assert.equal(conflictJob.ok, true, conflictJob.ok ? "" : conflictJob.code);
    if (!conflictJob.ok) return;
    assert.equal(conflictJob.job.status, "queued");
    const conflictValues = (await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: conflictJob.job.id } })).valuesJson as string[];
    assert.equal(conflictValues[0], "");

    const preview = await previewColumnMapDraft(
      {
        clientAccountId: customClient,
        mapId: customMapId,
        expectedRevision: 1,
        previewToken: "ray-preview",
        sourceLeadEventId: nurse.id,
      },
      db
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(preview.preview.sourceLeadEventId, nurse.id);
    assert.deepEqual(preview.preview.sheet?.values, nurseValues);
    const other = await previewColumnMapDraft(
      {
        clientAccountId: customClient,
        mapId: customMapId,
        expectedRevision: 1,
        previewToken: "trucker-preview",
        sourceLeadEventId: trucker.id,
      },
      db
    );
    assert.equal(other.ok, true);
    if (!other.ok) return;
    assert.deepEqual(other.preview.sheet?.values, truckerValues);
    assert.equal(other.preview.sheet?.values[0], "Trucker Web Form");

    const foreign = await createEvent({
      clientAccountId: v3Client,
      phone: "+12025550153",
      email: `foreign.${suffix}@example.test`,
      routingResultJson: { campaignLeadType: decision("resolved", "vet_web_form", "Vet Web Form") },
    });
    const denied = await previewColumnMapDraft(
      {
        clientAccountId: customClient,
        mapId: customMapId,
        expectedRevision: 1,
        previewToken: "foreign-preview",
        sourceLeadEventId: foreign.id,
      },
      db
    );
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.error, "lead_not_found");
  });

  it("keeps a pre-change job row and uses legacy text only when the snapshot is absent", async () => {
    const historical = await createEvent({
      clientAccountId: v3Client,
      phone: "+12025550151",
      email: `historical.${suffix}@example.test`,
      routingResultJson: { matched: true },
    });
    const historicalJob = await enqueueConfirmedLeadSheetsDelivery(historical.id, deps());
    assert.equal(historicalJob.ok, true, historicalJob.ok ? "" : historicalJob.code);
    if (!historicalJob.ok) return;
    const historicalValues = (await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: historicalJob.job.id } })).valuesJson as string[];
    assert.equal(historicalValues[COMPANY_SHEETS_V3_HEADER.indexOf("Lead Type")], "NURSE");

    const malformed = await createEvent({
      clientAccountId: v3Client,
      phone: "+12025550152",
      email: `malformed.${suffix}@example.test`,
      routingResultJson: { campaignLeadType: { version: 1, status: "resolved", leadTypeLabel: "Vet Web Form" } },
    });
    const malformedJob = await enqueueConfirmedLeadSheetsDelivery(malformed.id, deps());
    assert.equal(malformedJob.ok, true, malformedJob.ok ? "" : malformedJob.code);
    if (!malformedJob.ok) return;
    const malformedValues = (await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: malformedJob.job.id } })).valuesJson as string[];
    assert.equal(malformedValues[COMPANY_SHEETS_V3_HEADER.indexOf("Lead Type")], "");
    assert.notEqual(malformedValues[COMPANY_SHEETS_V3_HEADER.indexOf("Lead Type")], "NURSE");

    const old = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "queued",
        clientAccountId: v3Client,
        companyConnectionId: connectionId,
        destinationId: (await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: v3Client } })).id,
        spreadsheetId: v3Sheet,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${v3Sheet}`,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date(),
        headerContract: [...COMPANY_SHEETS_V3_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        idempotencyKey: `lead:${v3Client}:prechange-${suffix}`,
        rowsTotal: 1,
        sourceLeadEventId: historical.id,
      },
    });
    await db.companySheetsDeliveryRow.create({
      data: {
        jobId: old.id,
        spreadsheetId: v3Sheet,
        worksheetId: 0,
        stableRowId: `prechange-${suffix}`,
        ordinal: 0,
        valuesJson: ["FROZEN LEGACY", "5550100"],
        status: "pending",
      },
    });
    const before = sheet.appends.length;
    const executed = await executeCompanySheetsDeliveryJob(old.id, deps());
    assert.equal(executed.ok, true, executed.ok ? "" : executed.code);
    const appended = sheet.appends.slice(before).flat();
    assert.ok(appended.some((row) => row[0] === "FROZEN LEGACY" && row[1] === "5550100"));
  });
});
