/**
 * Local sa360_test coverage for an existing tab with a published column map.
 * Google is mocked. No production spreadsheet is written.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
  customRowValues,
  suggestColumnAssignments,
  syntheticCustomCampaignLead,
  type ColumnAssignment,
} from "./company-sheets-custom-row.js";
import {
  sendCompanySheetsCampaignTestRow,
  type CompanySheetsDeliveryDeps,
} from "./company-sheets-delivery.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "sheets@lifeagentlaunch.test";
const HEADER = ["Full Name", "Phone Number", "DOB", "Running Total", "E-mail"];
const HISTORICAL = ["Kept Person", "5550000000", "01/02/1980", "=D2", "kept@example.invalid"];
const GID = 7;

function confirm(header: readonly string[], sample: readonly string[]): ColumnAssignment[] {
  return suggestColumnAssignments(header, sample).map((column) => ({ ...column, explicit: true }));
}

describe("custom campaign writer on an existing tab", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const customClient = `csw_custom_${suffix}`;
  const v3Client = `csw_v3keep_${suffix}`;
  const customSheet = `customSheet${suffix}`;
  const v3Sheet = `v3KeepSheet${suffix}`;
  const cutoff = new Date("2026-10-27T14:43:39.233Z");
  let connectionId = "";
  const assignments = confirm(HEADER, HISTORICAL);
  const rows = [HEADER.slice(), HISTORICAL.slice()];
  const v3Rows = [[...COMPANY_SHEETS_V3_HEADER], Array.from(COMPANY_SHEETS_V3_HEADER, () => "historical")];
  const appends: Array<{ spreadsheetId: string; range: string; values: string[][] }> = [];
  const updates: Array<{ spreadsheetId: string; range: string; values: string[][] }> = [];
  let mode: "ok" | "drift" | "invalid" | "network" = "ok";

  function env(custom: boolean): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "false",
      SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED: custom ? "true" : "false",
    };
  }

  function deps(): CompanySheetsDeliveryDeps {
    return {
      env: env(true),
      db,
      now: () => new Date(),
      fetchImpl: async () => {
        throw new Error("unexpected Google fetch");
      },
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.custom-writer-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      }),
      getMetadata: async (input: { spreadsheetId: string }) => ({
        ok: true as const,
        metadata: {
          spreadsheetId: input.spreadsheetId,
          title: input.spreadsheetId === v3Sheet ? "V3 Workbook" : "Existing workbook",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`,
          worksheets:
            input.spreadsheetId === v3Sheet
              ? [{ sheetId: 4, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" }]
              : [
                  { sheetId: 0, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" },
                  { sheetId: GID, title: "VET Web Form", index: 1, hidden: false, sheetType: "GRID" },
                ],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Existing workbook",
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
      getValues: async (input) => {
        const grid = input.spreadsheetId === v3Sheet ? v3Rows : rows;
        const headerRow = input.spreadsheetId === customSheet && mode === "drift" ? ["Changed header"] : grid[0] ?? [];
        if (input.range.includes("A1:ZZ2")) return { ok: true as const, values: [headerRow, grid[1] ?? []] };
        if (input.range.includes("!A1:A")) return { ok: true as const, values: grid.map((row) => [row[0] ?? ""]) };
        return { ok: true as const, values: [] };
      },
      appendValues: async (input) => {
        appends.push({ spreadsheetId: input.spreadsheetId, range: input.range, values: input.values });
        if (mode === "invalid") return { ok: false as const, reason: "invalid_request" as const };
        if (mode === "network") return { ok: false as const, reason: "network_error" as const };
        const width = input.spreadsheetId === v3Sheet ? COMPANY_SHEETS_V3_HEADER.length : HEADER.length;
        const row = Array.from({ length: width }, () => "");
        const start = columnIndex(input.range);
        (input.values[0] ?? []).forEach((cell, index) => {
          row[start + index] = cell;
        });
        if (input.spreadsheetId === v3Sheet) v3Rows.push(row);
        else rows.push(row);
        const rowNumber = input.spreadsheetId === v3Sheet ? v3Rows.length : rows.length;
        const label = columnLabel(start);
        return { ok: true as const, updatedRange: `'VET Web Form'!${label}${rowNumber}` };
      },
      updateValues: async (input) => {
        updates.push({ spreadsheetId: input.spreadsheetId, range: input.range, values: input.values });
        const rowNumber = appendedRow(input.range);
        if (rowNumber == null || rowNumber < 2) return { ok: false as const, reason: "invalid_request" as const };
        const target = rows[rowNumber - 1];
        if (!target) return { ok: false as const, reason: "invalid_request" as const };
        const start = columnIndex(input.range);
        (input.values[0] ?? []).forEach((cell, index) => {
          target[start + index] = cell;
        });
        return { ok: true as const, updatedRange: input.range };
      },
    };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: customClient, clientDisplayName: "Custom tab", status: "active" },
        { clientAccountId: v3Client, clientDisplayName: "V3 tab", status: "active" },
      ],
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: `custom-writer-${suffix}`,
        googleUserId: `custom-writer-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    await seedDestination(customClient, customSheet, GID, "VET Web Form", COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA, HEADER);
    await seedDestination(v3Client, v3Sheet, 4, "Campaign Leads", "company_sheets_campaign_v3", [...COMPANY_SHEETS_V3_HEADER]);
    await db.clientSheetColumnMap.create({
      data: {
        clientAccountId: customClient,
        sourceScope: "shared",
        spreadsheetId: customSheet,
        worksheetId: GID,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: HEADER,
        assignments,
        revision: 2,
        publishedAt: new Date(),
      },
    });
    await db.clientSheetColumnMap.create({
      data: {
        clientAccountId: v3Client,
        sourceScope: "shared",
        spreadsheetId: v3Sheet,
        worksheetId: 4,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: ["Only"],
        assignments: [
          {
            sheetHeader: "Only",
            columnIndex: 0,
            formula: false,
            target: { kind: "v3_column", header: "Notes", sourceField: "notes" },
            transform: "passthrough",
            decision: "mapped",
            explicit: true,
            code: null,
          },
        ],
        revision: 2,
        publishedAt: new Date(),
      },
    });
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("refuses a custom append when the custom writer flag is off", async () => {
    const sent = await sendCompanySheetsCampaignTestRow(customClient, { ...deps(), env: env(false) });
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.code, "custom_writer_disabled");
    assert.equal(appends.length, 0);
    assert.equal(updates.length, 0);
  });

  it("appends one mapped row on the selected gid and leaves the header and historical row", async () => {
    mode = "ok";
    const beforeHeader = HEADER.slice();
    const beforeHistorical = HISTORICAL.slice();
    const sent = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.worksheetId, GID);
    assert.equal(sent.worksheetTitle, "VET Web Form");
    assert.equal(sent.spreadsheetId, customSheet);
    assert.equal(sent.rowWritten, true);
    assert.equal(sent.inventoryAffected, false);
    assert.equal(sent.deliveryEnabled, false);
    assert.equal(appends.length, 1);
    assert.equal(updates.length, 1);
    const append = appends[0];
    const update = updates[0];
    assert.ok(append);
    assert.ok(update);
    assert.equal(append.spreadsheetId, customSheet);
    assert.match(append.range, /VET Web Form/);
    assert.equal(append.range.includes("Campaign Leads"), false);
    const expected = customRowValues(
      assignments,
      syntheticCustomCampaignLead({
        stableRowId: "preview",
        clientAccountId: customClient,
        spreadsheetId: customSheet,
        worksheetTitle: "VET Web Form",
      })
    );
    assert.ok(expected);
    assert.deepEqual(append.values, [[expected?.[0] ?? "", expected?.[1] ?? "", expected?.[2] ?? ""]]);
    assert.equal(JSON.stringify(append.values).includes("=D2"), false);
    assert.equal(expected?.[2], "04/02/1990");
    assert.match(update.range, /'VET Web Form'!E[3-9]/);
    assert.ok((appendedRow(update.range) ?? 0) >= 2);
    assert.deepEqual(update.values, [[expected?.[4] ?? ""]]);
    assert.deepEqual(rows[0], beforeHeader);
    assert.deepEqual(rows[1], beforeHistorical);
    assert.equal(rows[1]?.[3], "=D2");
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: sent.jobId } });
    assert.equal(job.schemaVersion, COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA);
    assert.equal(job.worksheetId, GID);
    assert.match(job.contentSha256 ?? "", /^column-map:.+:v1$/);
    assert.equal(job.appendStartedAt, null);
    assert.equal(job.status, "succeeded");
  });

  it("retries an invalid append, then stops on header drift before another append", async () => {
    mode = "invalid";
    const beforeAppends = appends.length;
    const rejected = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.code, "test_row_not_written");
    assert.equal(appends.length, beforeAppends + 1);
    const held = await db.companySheetsDeliveryJob.findFirst({
      where: { clientAccountId: customClient, kind: "campaign_test", status: "retryable" },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(held?.lastError, "invalid_request");
    assert.equal(held?.appendStartedAt, null);
    mode = "ok";
    const retried = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(retried.ok, true);

    mode = "drift";
    const beforeDrift = appends.length;
    const drifted = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(drifted.ok, false);
    if (drifted.ok) return;
    assert.equal(drifted.code, "header_changed");
    assert.equal(appends.length, beforeDrift);
    const stopped = await db.companySheetsDeliveryJob.findFirst({
      where: { clientAccountId: customClient, kind: "campaign_test", status: "retryable" },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(stopped?.lastError, "header_changed");
    assert.equal(stopped?.appendStartedAt, null);
    assert.equal(stopped?.uncertainReason, null);
    await db.companySheetsDeliveryJob.deleteMany({
      where: { clientAccountId: customClient, status: "retryable" },
    });
    mode = "ok";
  });

  it("keeps an uncertain append unresolved and does not append again", async () => {
    mode = "network";
    const before = appends.length;
    const failed = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "uncertain");
    assert.equal(appends.length, before + 1);
    const held = await db.companySheetsDeliveryJob.findFirst({
      where: { clientAccountId: customClient, kind: "campaign_test", status: "uncertain" },
    });
    assert.ok(held?.appendStartedAt);
    const again = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "campaign_test_unresolved");
    assert.equal(appends.length, before + 1);
    mode = "ok";
  });

  it("keeps an exact v3 binding on the v3 mapper when a custom map also exists", async () => {
    const before = v3Rows[0]?.slice() ?? [];
    const historical = v3Rows[1]?.slice() ?? [];
    const sent = await sendCompanySheetsCampaignTestRow(v3Client, deps());
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.worksheetId, 4);
    assert.equal(sent.schemaVersion, "company_sheets_campaign_v3");
    const written = appends.filter((item) => item.spreadsheetId === v3Sheet);
    assert.equal(written.length, 1);
    assert.equal(written[0]?.values[0]?.length, COMPANY_SHEETS_V3_HEADER.length);
    assert.equal(updates.filter((item) => item.spreadsheetId === v3Sheet).length, 0);
    assert.deepEqual(v3Rows[0], before);
    assert.deepEqual(v3Rows[1], historical);
    const job = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: sent.jobId } });
    assert.equal(job.schemaVersion, "company_sheets_campaign_v3");
    assert.equal(job.contentSha256, null);
  });

  async function seedDestination(
    clientAccountId: string,
    spreadsheetId: string,
    worksheetId: number,
    worksheetTitle: string,
    schemaVersion: string,
    header: string[]
  ) {
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connectionId,
        spreadsheetId,
        spreadsheetTitle: worksheetTitle,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        worksheetId,
        worksheetTitle,
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        canaryApproved: false,
        campaignDispatchEnabled: false,
        campaignDispatchNotBefore: cutoff,
        agedDispatchEnabled: false,
        destinationRevision: 4,
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId,
        worksheetTitle,
        schemaVersion,
        headerContract: header,
        boundAt: new Date(),
      },
    });
  }

  async function cleanup() {
    const ids = [customClient, v3Client];
    const spreadsheets = [customSheet, v3Sheet];
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: { in: spreadsheets } } });
    await db.clientSheetColumnMap.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: `custom-writer-${suffix}` } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
  }
});

function columnIndex(range: string): number {
  const match = /!\$?([A-Z]+)/.exec(range);
  const letters = match?.[1] ?? "A";
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

function columnLabel(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function appendedRow(range: string): number | null {
  const match = /!\$?[A-Z]+\$?(\d+)/.exec(range);
  return match ? Number(match[1]) : null;
}
