/**
 * Local sa360_test coverage for the read-only stored-lead column preview.
 * Google and GoHighLevel are not called. The worksheet reader throws if used.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminClientOnboardingV2ConfigRoutes } from "../../routes/admin-client-onboarding-v2-config.js";
import {
  applyOperatorAssignments,
  type ColumnTransform,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import { listStoredLeadsForColumnPreview, previewStoredLeadColumnMap } from "./column-map-stored-lead-preview.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const ADMIN_KEY = "admin-key-stored-preview";
const HEADER = [
  "Date",
  "Client Name",
  "Phone",
  "Email",
  "State",
  "Age/ DOB",
  "Primary Reason",
  "Primary Concern",
  "Beneficiary",
  "Military Status",
  "Notes",
  "Lead Type",
  "Running Total",
  "Campaign",
  "Owner",
];
const MAPPED: Record<string, { header: string; sourceField: string; transform: ColumnTransform }> = {
  Date: { header: "Date", sourceField: "submitted_at", transform: "passthrough" },
  "Client Name": { header: "Client Name", sourceField: "full_name", transform: "passthrough" },
  Phone: { header: "Phone", sourceField: "phone", transform: "passthrough" },
  Email: { header: "Email", sourceField: "email", transform: "passthrough" },
  State: { header: "State", sourceField: "state", transform: "passthrough" },
  "Age/ DOB": { header: "DOB", sourceField: "date_of_birth", transform: "date_america_new_york" },
  "Primary Reason": { header: "Primary Reason", sourceField: "primary_reason", transform: "passthrough" },
  "Primary Concern": { header: "Primary Concern", sourceField: "primary_concern", transform: "passthrough" },
  Beneficiary: { header: "Beneficiary", sourceField: "beneficiary", transform: "passthrough" },
  "Military Status": { header: "Military Status", sourceField: "military_status", transform: "passthrough" },
  Notes: { header: "Notes", sourceField: "notes", transform: "passthrough" },
  "Lead Type": { header: "Lead Type", sourceField: "lead_type", transform: "passthrough" },
};
const EMAIL = "ada.preview.distinct@example.invalid";
const PHONE = "+15555550100";

function payload() {
  return {
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      email: EMAIL,
      phone_e164: PHONE,
      state: "TX",
    },
    state: { lead_type: "VET" },
    routing: {
      source_intake: {
        submitted_at: "2026-10-26T15:04:00.000Z",
        sourceAttributes: {
          primary_reason: "Family",
          age: "47",
          military_status: "Veteran",
          beneficiary: "Spouse",
        },
        unmappedSourceFieldsJson: [{ key: "notes", value: "Call after 5" }],
      },
    },
  };
}

function assignmentsFor(header: readonly string[]) {
  const input = header.map((sheetHeader) => {
    const mapped = MAPPED[sheetHeader];
    if (!mapped) {
      return { sheetHeader, decision: "unmapped", transform: "blank", explicit: true, formula: sheetHeader === "Running Total", target: null };
    }
    return {
      sheetHeader,
      decision: "mapped",
      transform: mapped.transform,
      explicit: true,
      formula: false,
      target: { kind: "v3_column", header: mapped.header, sourceField: mapped.sourceField },
    };
  });
  const sample = header.map((cell) => (cell === "Running Total" ? "=" : ""));
  const applied = applyOperatorAssignments(header, sample, input);
  if (!applied.ok) throw new Error(applied.error);
  return applied.assignments;
}

describe("stored lead column preview", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientAccountId = `preview_${suffix}`;
  const otherClient = `preview_other_${suffix}`;
  const spreadsheetId = `previewSheet${suffix}`;
  const otherSheet = `previewOther${suffix}`;
  let mapId = "";
  let draftMapId = "";
  let absentMapId = "";
  let newerEventId = "";
  let olderEventId = "";
  let foreignEventId = "";
  let reads = 0;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId, clientDisplayName: "Preview client", status: "active" },
        { clientAccountId: otherClient, clientDisplayName: "Other preview client", status: "active" },
      ],
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: `preview-${suffix}`,
        googleUserId: `preview-${suffix}`,
        googleEmail: "sheets@lifeagentlaunch.test",
        status: "connected",
        scopes: ["openid", "email"],
        tokenVersion: 1,
      },
    });
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connection.id,
        spreadsheetId,
        spreadsheetTitle: "Preview workbook",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        worksheetId: 15,
        worksheetTitle: "VET Web Form",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: false,
        agedDispatchEnabled: false,
        destinationRevision: 1,
        writeReadiness: "verified",
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 15,
        worksheetTitle: "VET Web Form",
        schemaVersion: "company_sheets_campaign_custom_v1",
        headerContract: HEADER,
        boundAt: new Date(),
      },
    });
    const assignments = assignmentsFor(HEADER);
    const published = await db.clientSheetColumnMap.create({
      data: {
        clientAccountId,
        sourceScope: "shared",
        spreadsheetId,
        worksheetId: 15,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: HEADER,
        assignments,
        revision: 2,
        publishedAt: new Date("2026-10-27T12:00:00.000Z"),
      },
    });
    mapId = published.id;
    const draft = await db.clientSheetColumnMap.create({
      data: {
        clientAccountId,
        sourceScope: "shared",
        spreadsheetId,
        worksheetId: 15,
        mapVersion: 2,
        status: "draft",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: HEADER,
        assignments,
        revision: 1,
      },
    });
    draftMapId = draft.id;
    const absent = await db.clientSheetColumnMap.create({
      data: {
        clientAccountId,
        sourceScope: "shared",
        spreadsheetId: otherSheet,
        worksheetId: 15,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: HEADER,
        assignments,
        revision: 1,
        publishedAt: new Date("2026-10-27T12:00:00.000Z"),
      },
    });
    absentMapId = absent.id;
    const older = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "webhook",
        sourceCampaignName: "Old source proof",
        clientAccountIdResolved: clientAccountId,
        rawPayloadJson: {},
        normalizedPayloadJson: { contact: { email: "old.proof@example.invalid" } },
        receivedAt: new Date("2026-09-01T12:00:00.000Z"),
      },
    });
    olderEventId = older.id;
    const newer = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignName: "VET Web Form",
        sourceRouteKey: "vet-web-form",
        clientAccountIdResolved: clientAccountId,
        rawPayloadJson: {},
        normalizedPayloadJson: payload(),
        receivedAt: new Date("2026-10-26T15:04:00.000Z"),
      },
    });
    newerEventId = newer.id;
    const foreign = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignName: "VET Web Form",
        clientAccountIdResolved: otherClient,
        rawPayloadJson: {},
        normalizedPayloadJson: payload(),
        receivedAt: new Date("2026-10-27T15:04:00.000Z"),
      },
    });
    foreignEventId = foreign.id;
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("lists the newest client-owned lead and refuses another client", async () => {
    const listed = await listStoredLeadsForColumnPreview({ clientAccountId, limit: 1 }, db);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.leads[0]?.id, newerEventId);
    assert.equal(listed.leads.some((lead) => lead.id === olderEventId), false);
    assert.equal(listed.leads.some((lead) => lead.id === foreignEventId), false);
    assert.match(listed.leads[0]?.label ?? "", /10\/26\/2026/);
    assert.match(listed.leads[0]?.label ?? "", /a\*\*\*@example\.invalid/);
    assert.match(listed.leads[0]?.label ?? "", /\*\*\*0100/);
    const body = JSON.stringify(listed);
    assert.equal(body.includes("ada.preview.distinct"), false);
    assert.equal(body.includes("Lovelace"), false);
    assert.equal(body.includes(PHONE), false);
    const page = await listStoredLeadsForColumnPreview({ clientAccountId, limit: 1, cursor: listed.nextCursor }, db);
    assert.equal(page.ok, true);
    if (!page.ok) return;
    assert.equal(page.leads[0]?.id, olderEventId);
    const searched = await listStoredLeadsForColumnPreview({ clientAccountId, query: "VET Web", limit: 20 }, db);
    assert.equal(searched.ok, true);
    if (!searched.ok) return;
    assert.deepEqual(searched.leads.map((lead) => lead.id), [newerEventId]);
    const byDay = await listStoredLeadsForColumnPreview({ clientAccountId, query: "2026-10-26", limit: 20 }, db);
    assert.equal(byDay.ok, true);
    if (!byDay.ok) return;
    assert.deepEqual(byDay.leads.map((lead) => lead.id), [newerEventId]);
    const foreign = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: foreignEventId,
        spreadsheetId,
        worksheetId: 15,
        mapId,
        basis: "published",
      },
      db
    );
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.statusCode, 403);
    assert.equal(foreign.error, "event_not_client_owned");
    assert.equal(JSON.stringify(foreign).includes(EMAIL), false);
  });

  it("previews the published map and a draft change without writing", async () => {
    const before = await db.clientSheetColumnMap.findUniqueOrThrow({ where: { id: mapId } });
    const jobs = await db.companySheetsDeliveryJob.count({ where: { clientAccountId } });
    const runs = await db.clientOnboardingTestRun.count({ where: { clientAccountId } });
    const inventory = await db.leadInventoryItem.count({ where: { sourceLeadEventId: { in: [newerEventId, olderEventId, foreignEventId] } } });
    const preview = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId,
        worksheetId: 15,
        mapId,
        basis: "published",
        assignments: assignmentsFor(HEADER).map((column) =>
          column.sheetHeader === "Notes" ? { ...column, decision: "unmapped", transform: "blank", target: null } : column
        ),
      },
      db
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(preview.deliveryReady, false);
    assert.equal(preview.googleHeaderIndependentlyReread, false);
    assert.equal(preview.publishedMapUnchanged, true);
    assert.equal(preview.map.headerFingerprintMatchesBinding, true);
    assert.equal(preview.reasons.includes("google_header_not_reread"), true);
    assert.equal(preview.reasons.includes("header_fingerprint_mismatch"), false);
    const concern = preview.columns.find((column) => column.sheetHeader === "Primary Concern");
    const dob = preview.columns.find((column) => column.sheetHeader === "Age/ DOB");
    const reason = preview.columns.find((column) => column.sheetHeader === "Primary Reason");
    const notes = preview.columns.find((column) => column.sheetHeader === "Notes");
    assert.equal(concern?.formattedValue, "");
    assert.equal(concern?.warnings.some((warning) => warning.code === "missing_source_value"), true);
    assert.equal(dob?.formattedValue, "");
    assert.equal(reason?.formattedValue, "Family");
    assert.equal(notes?.formattedValue, "Call after 5");
    assert.equal(preview.operatorDecisions.some((decision) => decision.code === "primary_concern_not_replaced"), true);
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/stored-lead-preview.example.json",
      JSON.stringify(
        {
          synthetic: true,
          leadLabel: preview.lead.label,
          deliveryReady: preview.deliveryReady,
          googleHeaderIndependentlyReread: preview.googleHeaderIndependentlyReread,
          reasons: preview.reasons,
          operatorDecisions: preview.operatorDecisions,
          columns: preview.columns.map((column) => ({
            column: `${column.columnLetter} · ${column.position}`,
            sheetHeader: column.sheetHeader,
            sourceField: column.sourceField,
            formattedValue: column.formattedValue,
            appended: column.appended,
            warnings: column.warnings.map((warning) => warning.code),
          })),
        },
        null,
        2
      )
    );
    const draft = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId,
        worksheetId: 15,
        mapId,
        basis: "draft",
        assignments: assignmentsFor(HEADER).map((column) =>
          column.sheetHeader === "Notes" ? { ...column, decision: "unmapped", transform: "blank", target: null } : column
        ),
      },
      db
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.equal(draft.columns.find((column) => column.sheetHeader === "Notes")?.formattedValue, "");
    assert.equal(draft.reasons.includes("draft_not_published"), true);
    const swapped = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId,
        worksheetId: 15,
        mapId,
        basis: "draft",
        assignments: assignmentsFor(HEADER).map((column) =>
          column.sheetHeader === "Primary Concern"
            ? { ...column, target: { kind: "v3_column", header: "Primary Reason", sourceField: "primary_reason" } }
            : column
        ),
      },
      db
    );
    assert.equal(swapped.ok, false);
    if (swapped.ok) return;
    assert.equal(swapped.error, "primary_reason_is_not_primary_concern");
    const after = await db.clientSheetColumnMap.findUniqueOrThrow({ where: { id: mapId } });
    assert.equal(after.revision, before.revision);
    assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.deepEqual(after.assignments, before.assignments);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId } }), jobs);
    assert.equal(await db.clientOnboardingTestRun.count({ where: { clientAccountId } }), runs);
    assert.equal(
      await db.leadInventoryItem.count({ where: { sourceLeadEventId: { in: [newerEventId, olderEventId, foreignEventId] } } }),
      inventory
    );
    const unpublished = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId,
        worksheetId: 15,
        mapId: draftMapId,
        basis: "published",
      },
      db
    );
    assert.equal(unpublished.ok, false);
    if (unpublished.ok) return;
    assert.equal(unpublished.error, "map_not_published");
  });

  it("marks a stale or missing binding and does not call Google", async () => {
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId } });
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: { headerContract: HEADER.map((cell, index) => (index === 10 ? "Note" : cell)) },
    });
    const stale = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId,
        worksheetId: 15,
        mapId,
        basis: "published",
      },
      db
    );
    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    assert.equal(stale.deliveryReady, false);
    assert.equal(stale.map.headerFingerprintMatchesBinding, false);
    assert.equal(stale.reasons.includes("header_fingerprint_mismatch"), true);
    assert.equal(stale.columns[10]?.warnings.some((warning) => warning.code === "stale_mapping"), true);
    assert.match(stale.columns[0]?.formattedValue ?? "", /10\/26\/2026/);
    const absent = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId: otherSheet,
        worksheetId: 15,
        mapId: absentMapId,
        basis: "published",
      },
      db
    );
    assert.equal(absent.ok, true);
    if (!absent.ok) return;
    assert.equal(absent.reasons.includes("binding_absent"), true);
    assert.equal(absent.deliveryReady, false);
    const mismatch = await previewStoredLeadColumnMap(
      {
        clientAccountId,
        sourceLeadEventId: newerEventId,
        spreadsheetId,
        worksheetId: 99,
        mapId,
        basis: "published",
      },
      db
    );
    assert.equal(mismatch.ok, false);
    if (mismatch.ok) return;
    assert.equal(mismatch.error, "map_target_mismatch");

    const previousFlag = process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
    const previousAdmin = process.env.ADMIN_API_KEY;
    process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = "true";
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    reads = 0;
    const app = Fastify({ logger: false });
    await app.register(adminClientOnboardingV2ConfigRoutes, {
      prefix: "/admin/v1",
      env: process.env,
      readExistingWorksheet: async () => {
        reads += 1;
        throw new Error("google worksheet read");
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/admin/v1/clients/${clientAccountId}/onboarding/column-map-preview`,
        headers: { "x-sa360-admin-key": ADMIN_KEY },
        payload: {
          sourceLeadEventId: newerEventId,
          spreadsheetId,
          worksheetId: 15,
          mapId,
          basis: "published",
        },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.externalCalls.sheets, false);
      assert.equal(body.externalCalls.ghl, false);
      assert.equal(body.writes, false);
      assert.equal(body.persisted, false);
      assert.equal(body.deliveryReady, false);
      assert.equal(JSON.stringify(body).includes("rawPayloadJson"), false);
      assert.equal(reads, 0);
      const observer = await app.inject({
        method: "POST",
        url: `/admin/v1/clients/${clientAccountId}/onboarding/column-map-preview`,
        headers: { "x-sa360-admin-key": ADMIN_KEY, cookie: "theme=1; sa360_admin_session=observer" },
        payload: {
          sourceLeadEventId: newerEventId,
          spreadsheetId,
          worksheetId: 15,
          mapId,
          basis: "published",
        },
      });
      assert.equal(observer.statusCode, 403);
      assert.equal(observer.json().error, "forbidden");
      assert.equal(JSON.stringify(observer.json()).includes(EMAIL), false);
    } finally {
      await app.close();
      if (previousFlag === undefined) delete process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
      else process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = previousFlag;
      if (previousAdmin === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousAdmin;
    }
    const switches = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(switches.campaignDispatchEnabled, false);
    assert.equal(switches.agedDispatchEnabled, false);
    assert.equal(switches.enabled, false);
  });

  async function cleanup() {
    const ids = [clientAccountId, otherClient];
    const events = [newerEventId, olderEventId, foreignEventId].filter(Boolean);
    if (events.length > 0) {
      await db.clientOnboardingTestRun.deleteMany({ where: { sourceLeadEventId: { in: events } } });
      await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: events } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: events } } });
    }
    await db.sourceLeadEvent.deleteMany({ where: { clientAccountIdResolved: { in: ids } } });
    await db.clientOnboardingTestRun.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.clientSheetColumnMap.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: `preview-${suffix}` } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
  }
});
