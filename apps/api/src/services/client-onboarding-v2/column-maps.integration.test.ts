/**
 * Local sa360_test coverage for existing-tab selection and versioned maps.
 * The worksheet reader is supplied by the caller, so Google is not called.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  createColumnMapDraft,
  patchColumnMap,
  publishColumnMap,
  retireColumnMap,
  saveExistingSheetsTarget,
  type ExistingWorksheetSnapshot,
} from "./column-maps.js";
import { suggestColumnAssignments, type ColumnAssignment } from "../company-sheets-delivery/company-sheets-custom-row.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const HEADER = ["Full Name", "Phone Number", "E-mail", "Age/DOB", "Score"];
const SAMPLE = ["Pat Example", "5550001111", "pat@example.invalid", "", "9"];

function legacySnapshot(spreadsheetId: string, header = HEADER): ExistingWorksheetSnapshot {
  return {
    spreadsheetId,
    spreadsheetTitle: "Existing workbook",
    worksheetId: 15,
    worksheetTitle: "VET Web Form",
    header,
    sampleRow: SAMPLE,
    classification: "legacy_custom_required",
    historicalDataRows: "has_rows",
  };
}

function confirm(header: readonly string[]): ColumnAssignment[] {
  return suggestColumnAssignments(header, SAMPLE).map((column) => {
    if (column.sheetHeader.trim() === "Age/DOB") {
      return {
        ...column,
        decision: "mapped",
        explicit: true,
        transform: "date_america_new_york",
        target: { kind: "v3_column", header: "DOB", sourceField: "date_of_birth" },
        code: null,
      };
    }
    if (column.decision === "mapped") return { ...column, explicit: true };
    return { ...column, decision: "unmapped", explicit: true, transform: "blank", target: null };
  });
}

describe("existing tab column maps", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientAccountId = `cmap_${suffix}`;
  const otherClient = `cmap_other_${suffix}`;
  const oldSheet = `oldCampaign${suffix}`;
  const existingSheet = `existingTab${suffix}`;
  const foreignSheet = `foreignSheet${suffix}`;
  const cutoff = new Date("2026-10-27T14:43:39.233Z");
  let connectionId = "";
  let historicalJobId = "";

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId, clientDisplayName: "Map client", status: "active" },
        { clientAccountId: otherClient, clientDisplayName: "Other client", status: "active" },
      ],
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: `column-map-${suffix}`,
        googleUserId: `column-map-${suffix}`,
        googleEmail: "sheets@lifeagentlaunch.test",
        status: "connected",
        scopes: ["openid", "email"],
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connectionId,
        spreadsheetId: oldSheet,
        spreadsheetTitle: "Campaign workbook",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${oldSheet}`,
        worksheetId: 99,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: cutoff,
        agedDispatchEnabled: false,
        destinationRevision: 4,
        writeReadiness: "verified",
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 99,
        worksheetTitle: "Campaign Leads",
        schemaVersion: "company_sheets_campaign_v3",
        headerContract: [...COMPANY_SHEETS_V3_HEADER],
        boundAt: new Date(),
      },
    });
    const historical = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "succeeded",
        clientAccountId,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: oldSheet,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${oldSheet}`,
        worksheetId: 99,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: destination.updatedAt,
        headerContract: [...COMPANY_SHEETS_V3_HEADER],
        schemaVersion: "company_sheets_campaign_v3",
        destinationRevision: 4,
        idempotencyKey: `lead:${clientAccountId}:historical`,
        rowsTotal: 1,
        rowsWritten: 1,
      },
    });
    historicalJobId = historical.id;
    await db.clientOnboardingActivationIntent.create({
      data: {
        clientAccountId,
        destination: "google_sheets_campaign",
        status: "ready_for_operator",
        requestId: randomUUID(),
        confirmationPhrase: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        activatesDelivery: false,
      },
    });
    await db.companySheetsDestination.create({
      data: {
        clientAccountId: otherClient,
        companyConnectionId: connectionId,
        spreadsheetId: foreignSheet,
        spreadsheetTitle: "Foreign",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${foreignSheet}`,
        worksheetId: 0,
        worksheetTitle: "Foreign",
        controlBasis: "drive_owner_verified",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: false,
      },
    });
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("requires a pause, versions one map, and preserves history, cutoff, and switches", async () => {
    const paused = await createColumnMapDraft(
      {
        clientAccountId,
        requestId: randomUUID(),
        spreadsheetId: existingSheet,
        worksheetId: 15,
        sourceScope: "shared",
        baseSchemaVersion: "legacy_custom",
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(paused.ok, false);
    if (paused.ok) return;
    assert.equal(paused.error, "delivery_not_paused");
    const stillOn = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(stillOn.campaignDispatchEnabled, true);
    assert.equal(stillOn.campaignDispatchNotBefore?.toISOString(), cutoff.toISOString());

    await db.companySheetsDestination.update({
      where: { clientAccountId },
      data: { campaignDispatchEnabled: false },
    });

    const exact = await createColumnMapDraft(
      {
        clientAccountId,
        requestId: randomUUID(),
        spreadsheetId: existingSheet,
        worksheetId: 0,
        sourceScope: "shared",
        baseSchemaVersion: "legacy_custom",
        snapshot: {
          ...legacySnapshot(existingSheet),
          worksheetId: 0,
          header: [...COMPANY_SHEETS_V3_HEADER],
          classification: "v3_exact_header",
          historicalDataRows: "empty",
        },
      },
      db
    );
    assert.equal(exact.ok, false);
    if (exact.ok) return;
    assert.equal(exact.error, "use_existing_v3_bind");

    const foreign = await saveExistingSheetsTarget(
      {
        clientAccountId,
        requestId: randomUUID(),
        snapshot: { ...legacySnapshot(foreignSheet), spreadsheetId: foreignSheet },
      },
      db
    );
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.error, "tenant_mismatch");

    const selected = await saveExistingSheetsTarget(
      { clientAccountId, requestId: randomUUID(), snapshot: legacySnapshot(existingSheet) },
      db
    );
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    assert.equal(selected.spreadsheetId, existingSheet);
    assert.equal(selected.worksheetId, 15);
    assert.equal(selected.schemaVersion, "company_sheets_campaign_v3");
    assert.equal(selected.setupState, "incompatible");
    assert.equal(selected.headerRewritten, false);
    assert.equal(selected.readinessEvidenceInvalidated, true);
    assert.equal(selected.campaignDispatchEnabled, false);
    assert.equal(selected.campaignDispatchNotBefore, cutoff.toISOString());
    const afterSelect = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId },
      include: { tabContracts: true },
    });
    assert.equal(afterSelect.destinationRevision, 5);
    assert.equal(afterSelect.writeReadiness, "not_verified");
    assert.equal(afterSelect.campaignDispatchEnabled, false);
    assert.equal(afterSelect.agedDispatchEnabled, false);
    assert.equal(afterSelect.enabled, false);
    assert.equal(afterSelect.campaignDispatchNotBefore?.toISOString(), cutoff.toISOString());
    const tab = afterSelect.tabContracts.find((item) => item.role === "campaign");
    assert.equal(tab?.worksheetId, 15);
    assert.equal(tab?.schemaVersion, "company_sheets_campaign_v3");
    assert.equal(tab?.setupState, "incompatible");
    const historical = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: historicalJobId } });
    assert.equal(historical.spreadsheetId, oldSheet);
    assert.equal(historical.worksheetId, 99);
    assert.equal(historical.status, "succeeded");
    const intent = await db.clientOnboardingActivationIntent.findFirstOrThrow({ where: { clientAccountId } });
    assert.equal(intent.status, "blocked");

    const blank = await createColumnMapDraft(
      {
        clientAccountId,
        requestId: randomUUID(),
        spreadsheetId: existingSheet,
        worksheetId: 15,
        sourceScope: "shared",
        baseSchemaVersion: "legacy_custom",
        snapshot: legacySnapshot(existingSheet, [...HEADER, ""]),
      },
      db
    );
    assert.equal(blank.ok, false);
    if (blank.ok) return;
    assert.equal(blank.error, "blank_header");
    assert.equal(await db.clientSheetColumnMap.count({ where: { clientAccountId } }), 0);

    const draft = await createColumnMapDraft(
      {
        clientAccountId,
        requestId: randomUUID(),
        spreadsheetId: existingSheet,
        worksheetId: 15,
        sourceScope: "shared",
        baseSchemaVersion: "legacy_custom",
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.equal(draft.map.status, "draft");
    assert.equal(draft.map.customMapping, true);
    assert.equal(draft.map.headerSnapshot.join("|"), HEADER.join("|"));
    const unresolved = draft.map.issues.some((issue) => issue.code === "ambiguous_age_or_dob" || issue.code === "mapping_unresolved");
    assert.equal(unresolved, true);
    const stillV3 = await db.companySheetsTabContract.findFirstOrThrow({
      where: { destinationId: afterSelect.id, role: "campaign" },
    });
    assert.equal(stillV3.schemaVersion, "company_sheets_campaign_v3");
    assert.equal((await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId } })).destinationRevision, 5);

    const early = await publishColumnMap(
      {
        clientAccountId,
        mapId: draft.map.id,
        requestId: randomUUID(),
        expectedRevision: draft.map.revision,
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(early.ok, false);
    if (early.ok) return;
    assert.equal(early.error, "mapping_unresolved");

    const patched = await patchColumnMap(
      {
        clientAccountId,
        mapId: draft.map.id,
        requestId: randomUUID(),
        expectedRevision: draft.map.revision,
        assignments: confirm(HEADER),
      },
      db
    );
    assert.equal(patched.ok, true);
    if (!patched.ok) return;
    assert.equal(patched.map.preview.find((cell) => cell.sheetHeader === "E-mail")?.value, "synthetic@example.invalid");
    assert.equal(patched.map.issues.some((issue) => issue.code === "required_field_unmapped"), false);

    const drifted = await publishColumnMap(
      {
        clientAccountId,
        mapId: draft.map.id,
        requestId: randomUUID(),
        expectedRevision: patched.map.revision,
        snapshot: legacySnapshot(existingSheet, ["Full Name", "Phone Number", "E-mail", "Age/DOB", "Score", "Extra"]),
      },
      db
    );
    assert.equal(drifted.ok, false);
    if (drifted.ok) return;
    assert.equal(drifted.error, "header_changed");
    assert.equal(
      (await db.companySheetsTabContract.findFirstOrThrow({ where: { destinationId: afterSelect.id, role: "campaign" } })).schemaVersion,
      "company_sheets_campaign_v3"
    );

    const published = await publishColumnMap(
      {
        clientAccountId,
        mapId: draft.map.id,
        requestId: randomUUID(),
        expectedRevision: patched.map.revision,
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(published.ok, true);
    if (!published.ok) return;
    assert.equal(published.schemaRebound, true);
    assert.equal(published.map.status, "published");
    const bound = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId },
      include: { tabContracts: true },
    });
    const campaign = bound.tabContracts.find((item) => item.role === "campaign");
    assert.equal(campaign?.schemaVersion, "company_sheets_campaign_custom_v1");
    assert.equal(campaign?.setupState, "bound");
    assert.equal(campaign?.worksheetId, 15);
    assert.equal(bound.spreadsheetId, existingSheet);
    assert.equal(bound.destinationRevision, 6);
    assert.equal(bound.writeReadiness, "not_verified");
    assert.equal(bound.campaignDispatchEnabled, false);
    assert.equal(bound.campaignDispatchNotBefore?.toISOString(), cutoff.toISOString());
    assert.equal(bound.agedDispatchEnabled, false);
    assert.equal(bound.enabled, false);
    assert.equal((await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: historicalJobId } })).worksheetId, 99);

    const replacement = await createColumnMapDraft(
      {
        clientAccountId,
        requestId: randomUUID(),
        spreadsheetId: existingSheet,
        worksheetId: 15,
        sourceScope: "shared",
        baseSchemaVersion: "legacy_custom",
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(replacement.ok, true);
    if (!replacement.ok) return;
    const blocked = await patchColumnMap(
      {
        clientAccountId,
        mapId: replacement.map.id,
        requestId: randomUUID(),
        expectedRevision: replacement.map.revision,
        assignments: confirm(HEADER),
      },
      db
    );
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    const secondPublish = await publishColumnMap(
      {
        clientAccountId,
        mapId: replacement.map.id,
        requestId: randomUUID(),
        expectedRevision: blocked.map.revision,
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(secondPublish.ok, false);
    if (secondPublish.ok) return;
    assert.equal(secondPublish.error, "published_map_exists");

    const duplicate = await publishColumnMap(
      {
        clientAccountId,
        mapId: draft.map.id,
        requestId: randomUUID(),
        expectedRevision: published.map.revision,
        snapshot: legacySnapshot(existingSheet),
      },
      db
    );
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.equal(duplicate.error, "revision_conflict");

    const retired = await retireColumnMap(
      { clientAccountId, mapId: draft.map.id, requestId: randomUUID() },
      db
    );
    assert.equal(retired.ok, true);
    if (!retired.ok) return;
    assert.equal(retired.map.status, "retired");
    const kept = await db.clientSheetColumnMap.findUniqueOrThrow({ where: { id: draft.map.id } });
    assert.equal(kept.status, "retired");
    const afterRetire = await db.companySheetsTabContract.findFirstOrThrow({
      where: { destinationId: afterSelect.id, role: "campaign" },
    });
    assert.equal(afterRetire.setupState, "incompatible");
    assert.equal(afterRetire.setupReason, "mapping_required");
    assert.equal((await db.companySheetsDeliveryJob.count({ where: { id: historicalJobId, status: "succeeded" } })), 1);
  });

  async function cleanup() {
    const ids = [clientAccountId, otherClient];
    await db.clientOnboardingActivationIntent.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.clientSheetColumnMap.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: `column-map-${suffix}` } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
  }
});
