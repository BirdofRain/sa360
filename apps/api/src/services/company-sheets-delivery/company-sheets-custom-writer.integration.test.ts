/**
 * Local sa360_test coverage for an existing tab with a published column map.
 * Google is mocked. No production spreadsheet is written.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { PrismaClient } from "@prisma/client";

import {
  COMPANY_SHEETS_ACCEPT_RECONCILED_ROW_PHRASE,
  COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
} from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
  customRowValues,
  suggestColumnAssignments,
  syntheticCustomCampaignLead,
  type ColumnAssignment,
} from "./company-sheets-custom-row.js";
import { deleteCompanySheetsDestinationForClient } from "../company-google/company-sheets-destination.service.js";
import {
  executeCompanySheetsDeliveryJob,
  releaseCompanySheetsDeliveryHold,
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
  const reorderSheet = `reorderSheet${suffix}`;
  const reorderClient = `csw_reorder_${suffix}`;
  const reorderHeader = ["E-mail", "Running Total", "Phone Number", "Full Name"];
  const reorderHistorical = ["kept@example.invalid", "=A2", "5550000000", "Kept Person"];
  const reorderRows = [reorderHeader.slice(), reorderHistorical.slice()];
  const cutoff = new Date("2026-10-27T14:43:39.233Z");
  let connectionId = "";
  const assignments = confirm(HEADER, HISTORICAL);
  const rows = [HEADER.slice(), HISTORICAL.slice()];
  const v3Rows = [[...COMPANY_SHEETS_V3_HEADER], Array.from(COMPANY_SHEETS_V3_HEADER, () => "historical")];
  const appends: Array<{ spreadsheetId: string; range: string; values: string[][] }> = [];
  const updates: Array<{ spreadsheetId: string; range: string; values: string[][] }> = [];
  let mode: "ok" | "drift" | "invalid" | "network" | "update_invalid" | "update_timeout" | "second_append_invalid" = "ok";
  let customAppendsThisMode = 0;

  function gridFor(spreadsheetId: string): string[][] {
    if (spreadsheetId === v3Sheet) return v3Rows;
    if (spreadsheetId === reorderSheet) return reorderRows;
    return rows;
  }

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
              : input.spreadsheetId === reorderSheet
                ? [{ sheetId: 15, title: "Existing Form", index: 0, hidden: false, sheetType: "GRID" }]
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
        const grid = gridFor(input.spreadsheetId);
        const headerRow = input.spreadsheetId === customSheet && mode === "drift" ? ["Changed header"] : grid[0] ?? [];
        if (input.range.includes("A1:ZZ2")) return { ok: true as const, values: [headerRow, grid[1] ?? []] };
        if (input.range.includes("!A1:A")) return { ok: true as const, values: grid.map((row) => [row[0] ?? ""]) };
        const rowMatch = /!\$?[A-Z]+\$?(\d+)/.exec(input.range);
        if (rowMatch?.[1]) return { ok: true as const, values: [grid[Number(rowMatch[1]) - 1] ?? []] };
        return { ok: true as const, values: [] };
      },
      appendValues: async (input) => {
        appends.push({ spreadsheetId: input.spreadsheetId, range: input.range, values: input.values });
        if (input.spreadsheetId === customSheet && mode === "invalid") return { ok: false as const, reason: "invalid_request" as const };
        if (input.spreadsheetId === customSheet && mode === "network") return { ok: false as const, reason: "network_error" as const };
        if (input.spreadsheetId === customSheet && mode === "second_append_invalid") {
          customAppendsThisMode += 1;
          if (customAppendsThisMode > 1) return { ok: false as const, reason: "invalid_request" as const };
        }
        const grid = gridFor(input.spreadsheetId);
        const width = grid[0]?.length ?? input.values[0]?.length ?? 0;
        const row = Array.from({ length: width }, () => "");
        const start = columnIndex(input.range);
        (input.values[0] ?? []).forEach((cell, index) => {
          row[start + index] = cell;
        });
        grid.push(row);
        const label = columnLabel(start);
        return { ok: true as const, updatedRange: `'${input.range.includes("Existing Form") ? "Existing Form" : "VET Web Form"}'!${label}${grid.length}` };
      },
      updateValues: async (input) => {
        updates.push({ spreadsheetId: input.spreadsheetId, range: input.range, values: input.values });
        if (input.spreadsheetId === customSheet && mode === "update_invalid") {
          return { ok: false as const, reason: "invalid_request" as const };
        }
        if (input.spreadsheetId === customSheet && mode === "update_timeout") {
          return { ok: false as const, reason: "network_error" as const };
        }
        const rowNumber = appendedRow(input.range);
        if (rowNumber == null || rowNumber < 2) return { ok: false as const, reason: "invalid_request" as const };
        const target = gridFor(input.spreadsheetId)[rowNumber - 1];
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
        { clientAccountId: reorderClient, clientDisplayName: "Reordered tab", status: "active" },
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
    await seedDestination(reorderClient, reorderSheet, 15, "Existing Form", COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA, reorderHeader);
    await db.clientSheetColumnMap.create({
      data: {
        clientAccountId: reorderClient,
        sourceScope: "shared",
        spreadsheetId: reorderSheet,
        worksheetId: 15,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: reorderHeader,
        assignments: confirm(reorderHeader, reorderHistorical),
        revision: 2,
        publishedAt: new Date(),
      },
    });
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

  it("keeps a cutoff when the destination is removed and runs a paused test with the writer flag off", async () => {
    const before = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: customClient } });
    const removed = await deleteCompanySheetsDestinationForClient(customClient, { env: env(false), db });
    assert.equal(removed.ok, false);
    if (removed.ok) return;
    assert.equal(removed.code, "cutoff_retained");
    const after = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: customClient } });
    assert.equal(after.id, before.id);
    assert.equal(after.campaignDispatchNotBefore?.toISOString(), before.campaignDispatchNotBefore?.toISOString());
    assert.equal(after.destinationRevision, before.destinationRevision);

    await db.companySheetsDestination.update({
      where: { clientAccountId: customClient },
      data: { campaignDispatchEnabled: true },
    });
    const blocked = await sendCompanySheetsCampaignTestRow(customClient, { ...deps(), env: env(false) });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "delivery_not_paused");
    assert.equal(appends.length, 0);
    await db.companySheetsDestination.update({
      where: { clientAccountId: customClient },
      data: { campaignDispatchEnabled: false },
    });
    const lead = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "queued",
        clientAccountId: customClient,
        companyConnectionId: connectionId,
        destinationId: before.id,
        spreadsheetId: customSheet,
        spreadsheetUrl: before.spreadsheetUrl,
        worksheetId: GID,
        worksheetTitle: "VET Web Form",
        controlBasis: before.controlBasis,
        destinationUpdatedAt: before.updatedAt,
        headerContract: HEADER,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        destinationRevision: before.destinationRevision,
        idempotencyKey: `lead:${customClient}:writer-off`,
        rowsTotal: 1,
        rows: {
          create: {
            spreadsheetId: customSheet,
            worksheetId: GID,
            stableRowId: `lead:${customClient}:writer-off`,
            ordinal: 0,
            valuesJson: ["Live", "555", "", "", "live@example.invalid"],
            status: "pending",
          },
        },
      },
    });
    const live = await executeCompanySheetsDeliveryJob(lead.id, {
      ...deps(),
      env: { ...env(false), SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true" },
    });
    assert.equal(live.ok, false);
    if (live.ok) return;
    assert.equal(live.code, "custom_writer_disabled");
    assert.equal(appends.length, 0);
    await db.companySheetsDeliveryJob.delete({ where: { id: lead.id } });
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
    const beforeFlagOff = appends.length;
    const flagOff = await sendCompanySheetsCampaignTestRow(customClient, { ...deps(), env: env(false) });
    assert.equal(flagOff.ok, true);
    if (!flagOff.ok) return;
    assert.equal(flagOff.worksheetId, GID);
    assert.equal(appends.length, beforeFlagOff + 1);
    assert.equal(rows[1]?.[3], "=D2");
  });

  it("keeps a reordered formula column empty on the new row and does not shift later cells", async () => {
    const beforeHeader = reorderHeader.slice();
    const beforeHistorical = reorderHistorical.slice();
    const beforeAppends = appends.length;
    const sent = await sendCompanySheetsCampaignTestRow(reorderClient, deps());
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.worksheetId, 15);
    const append = appends[beforeAppends];
    const update = updates.find((item) => item.spreadsheetId === reorderSheet);
    assert.ok(append);
    assert.ok(update);
    assert.match(append.range, /Existing Form'!A1/);
    assert.equal(append.values[0]?.length, 1);
    assert.equal(append.values[0]?.[0], "synthetic@example.invalid");
    assert.match(update.range, /Existing Form'!C[3-9]/);
    assert.equal(update.values[0]?.length, 2);
    assert.equal(JSON.stringify(append.values).includes("=A2"), false);
    assert.equal(JSON.stringify(update.values).includes("=A2"), false);
    const inserted = reorderRows[reorderRows.length - 1];
    assert.equal(inserted?.[1], "");
    assert.equal(inserted?.[0], "synthetic@example.invalid");
    assert.deepEqual(reorderRows[0], beforeHeader);
    assert.deepEqual(reorderRows[1], beforeHistorical);
    assert.equal(reorderRows[1]?.[1], "=A2");
  });

  it("fences a partial row when the update after the append fails", async () => {
    mode = "update_invalid";
    const beforeAppends = appends.length;
    const beforeRows = rows.length;
    const failed = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "partial_row_confirmed");
    assert.equal(appends.length, beforeAppends + 1);
    assert.equal(rows.length, beforeRows + 1);
    const partial = rows[rows.length - 1];
    assert.equal(partial?.[3], "");
    assert.equal(partial?.[4], "");
    assert.equal(rows[1]?.[3], "=D2");
    const held = await db.companySheetsDeliveryJob.findFirst({
      where: { clientAccountId: customClient, kind: "campaign_test", status: "uncertain" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(held?.appendStartedAt);
    assert.equal(held?.uncertainReason, "partial_row_confirmed");
    assert.match(held?.lastError ?? "", /^partial_row_confirmed:[2-9]\d*$/);
    const removed = await deleteCompanySheetsDestinationForClient(customClient, { env: env(true), db });
    assert.equal(removed.ok, false);
    if (removed.ok) return;
    assert.equal(removed.code, "unresolved_delivery");
    const releaseEnv = { ...deps(), env: { ...env(true), SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true" } };
    const retry = await releaseCompanySheetsDeliveryHold(held?.id ?? "", COMPANY_SHEETS_RELEASE_HOLD_PHRASE, releaseEnv);
    assert.equal(retry.ok, false);
    if (retry.ok) return;
    assert.equal(retry.code, "partial_row_hold");
    const wrong = await releaseCompanySheetsDeliveryHold(held?.id ?? "", COMPANY_SHEETS_ACCEPT_RECONCILED_ROW_PHRASE, releaseEnv, 2);
    assert.equal(wrong.ok, false);
    if (wrong.ok) return;
    assert.equal(wrong.code, "reconciled_row_mismatch");
    const accepted = await releaseCompanySheetsDeliveryHold(
      held?.id ?? "",
      COMPANY_SHEETS_ACCEPT_RECONCILED_ROW_PHRASE,
      releaseEnv
    );
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.status, "succeeded");
    assert.equal(accepted.appended, false);
    assert.equal(appends.length, beforeAppends + 1);
    assert.equal(rows[1]?.[3], "=D2");
    const closed = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: held?.id } });
    assert.equal(closed.status, "succeeded");
    assert.equal(closed.appendStartedAt, null);
    mode = "ok";

    mode = "update_timeout";
    const beforeTimeout = appends.length;
    const beforeTimeoutRows = rows.length;
    const timedOut = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(timedOut.ok, false);
    if (timedOut.ok) return;
    assert.equal(timedOut.code, "partial_row_confirmed");
    assert.equal(appends.length, beforeTimeout + 1);
    assert.equal(rows.length, beforeTimeoutRows + 1);
    assert.equal(rows.at(-1)?.[3], "");
    const timedOutJob = await db.companySheetsDeliveryJob.findFirst({
      where: { clientAccountId: customClient, status: "uncertain" },
      orderBy: { createdAt: "desc" },
    });
    const retryTimeout = await sendCompanySheetsCampaignTestRow(customClient, deps());
    assert.equal(retryTimeout.ok, false);
    if (retryTimeout.ok) return;
    assert.equal(retryTimeout.code, "campaign_test_unresolved");
    assert.equal(appends.length, beforeTimeout + 1);
    await db.companySheetsDeliveryJob.deleteMany({ where: { id: timedOutJob?.id } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: customSheet } });

    mode = "second_append_invalid";
    customAppendsThisMode = 0;
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: customClient } });
    const batch = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "queued",
        clientAccountId: customClient,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: customSheet,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: GID,
        worksheetTitle: "VET Web Form",
        controlBasis: destination.controlBasis,
        destinationUpdatedAt: destination.updatedAt,
        headerContract: HEADER,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        destinationRevision: destination.destinationRevision,
        idempotencyKey: `lead:${customClient}:batch`,
        rowsTotal: 2,
        rows: {
          create: [
            {
              spreadsheetId: customSheet,
              worksheetId: GID,
              stableRowId: `lead:${customClient}:batch:0`,
              ordinal: 0,
              valuesJson: ["First", "555", "04/02/1990", "", "first@example.invalid"],
              status: "pending",
            },
            {
              spreadsheetId: customSheet,
              worksheetId: GID,
              stableRowId: `lead:${customClient}:batch:1`,
              ordinal: 1,
              valuesJson: ["Second", "556", "04/03/1990", "", "second@example.invalid"],
              status: "pending",
            },
          ],
        },
      },
    });
    const beforeBatch = appends.length;
    const beforeBatchRows = rows.length;
    const batched = await executeCompanySheetsDeliveryJob(batch.id, {
      ...deps(),
      env: { ...env(true), SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true" },
    });
    assert.equal(batched.ok, false);
    if (batched.ok) return;
    assert.equal(batched.code, "uncertain");
    assert.equal(appends.length, beforeBatch + 2);
    assert.equal(rows.length, beforeBatchRows + 1);
    const againBatch = await executeCompanySheetsDeliveryJob(batch.id, {
      ...deps(),
      env: { ...env(true), SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true" },
    });
    assert.equal(againBatch.ok, false);
    if (againBatch.ok) return;
    assert.equal(againBatch.code, "uncertain");
    assert.equal(appends.length, beforeBatch + 2);
    assert.equal(rows.length, beforeBatchRows + 1);
    await db.companySheetsDeliveryJob.delete({ where: { id: batch.id } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: customSheet } });
    mode = "ok";
  });

  it("does not retarget a queued test or a queued lead when the tab and map change", async () => {
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: customClient } });
    const queued = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "campaign_test",
        status: "queued",
        clientAccountId: customClient,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: customSheet,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: GID,
        worksheetTitle: "VET Web Form",
        controlBasis: destination.controlBasis,
        destinationUpdatedAt: destination.updatedAt,
        headerContract: HEADER,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        destinationRevision: destination.destinationRevision,
        contentSha256: "column-map:queued:v1",
        idempotencyKey: `campaign-test:${customClient}:queued-target`,
        rowsTotal: 1,
        rows: {
          create: {
            spreadsheetId: customSheet,
            worksheetId: GID,
            stableRowId: `campaign-test:${customClient}:queued-target`,
            ordinal: 0,
            valuesJson: ["Queued Name", "555", "04/02/1990", "", "queued@example.invalid"],
            status: "pending",
          },
        },
      },
    });
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: { worksheetId: 0, worksheetTitle: "Campaign Leads", schemaVersion: "company_sheets_campaign_v3" },
    });
    const beforeAppends = appends.length;
    const moved = await executeCompanySheetsDeliveryJob(queued.id, { ...deps(), controlledCampaignTest: true });
    assert.equal(moved.ok, false);
    if (moved.ok) return;
    assert.equal(moved.code, "campaign_test_destination_changed");
    assert.equal(appends.length, beforeAppends);
    const fenced = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.id } });
    assert.equal(fenced.status, "uncertain");
    assert.equal(fenced.worksheetId, GID);
    assert.equal(fenced.uncertainReason, "campaign_test_destination_changed");
    await db.companySheetsDeliveryJob.delete({ where: { id: queued.id } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: customSheet } });

    const snapshot = ["Snapshot Name", "5551112222", "04/02/1990", "", "snapshot@example.invalid"];
    const leadJob = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "queued",
        clientAccountId: customClient,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: customSheet,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: GID,
        worksheetTitle: "VET Web Form",
        controlBasis: destination.controlBasis,
        destinationUpdatedAt: destination.updatedAt,
        headerContract: HEADER,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        destinationRevision: destination.destinationRevision,
        contentSha256: "column-map:snapshot:v1",
        idempotencyKey: `lead:${customClient}:snapshot`,
        rowsTotal: 1,
        rows: {
          create: {
            spreadsheetId: customSheet,
            worksheetId: GID,
            stableRowId: `lead:${customClient}:snapshot`,
            ordinal: 0,
            valuesJson: snapshot,
            status: "pending",
          },
        },
      },
    });
    const map = await db.clientSheetColumnMap.findFirstOrThrow({
      where: { clientAccountId: customClient, status: "published" },
    });
    const originalAssignments = map.assignments;
    await db.clientSheetColumnMap.update({
      where: { id: map.id },
      data: { mapVersion: map.mapVersion + 1, headerSnapshot: ["Moved"] },
    });
    const lead = await executeCompanySheetsDeliveryJob(leadJob.id, {
      ...deps(),
      env: { ...env(true), SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true" },
    });
    assert.equal(lead.ok, true);
    if (!lead.ok) return;
    const leadAppend = appends.filter((item) => item.spreadsheetId === customSheet).at(-1);
    const leadUpdate = updates.filter((item) => item.spreadsheetId === customSheet).at(-1);
    assert.match(leadAppend?.range ?? "", /VET Web Form'!A1/);
    assert.deepEqual(leadAppend?.values, [["Snapshot Name", "5551112222", "04/02/1990"]]);
    assert.deepEqual(leadUpdate?.values, [["snapshot@example.invalid"]]);
    const stored = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: leadJob.id } });
    assert.equal(stored.worksheetId, GID);
    assert.equal(stored.contentSha256, "column-map:snapshot:v1");
    assert.equal(stored.spreadsheetId, customSheet);
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: {
        worksheetId: GID,
        worksheetTitle: "VET Web Form",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        headerContract: HEADER,
        setupState: "bound",
      },
    });
    await db.clientSheetColumnMap.update({
      where: { id: map.id },
      data: { mapVersion: map.mapVersion, headerSnapshot: HEADER, assignments: originalAssignments ?? [] },
    });
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
    const blockedLead = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "queued",
        clientAccountId: customClient,
        companyConnectionId: connectionId,
        destinationId: (await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: customClient } })).id,
        spreadsheetId: customSheet,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${customSheet}`,
        worksheetId: GID,
        worksheetTitle: "VET Web Form",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date(),
        headerContract: HEADER,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        destinationRevision: 4,
        idempotencyKey: `lead:${customClient}:blocked`,
        rowsTotal: 1,
        rows: {
          create: {
            spreadsheetId: customSheet,
            worksheetId: GID,
            stableRowId: `lead:${customClient}:blocked`,
            ordinal: 0,
            valuesJson: ["Blocked", "555", "", "", "blocked@example.invalid"],
            status: "pending",
          },
        },
      },
    });
    const blocked = await executeCompanySheetsDeliveryJob(blockedLead.id, {
      ...deps(),
      env: { ...env(true), SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true" },
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "worksheet_busy");
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
    const ids = [customClient, v3Client, reorderClient];
    const spreadsheets = [customSheet, v3Sheet, reorderSheet];
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
