import type { CompanySheetsDestination, CompanySheetsTabContract, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_AGED_TAB_TITLE,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_TAB_TITLE,
  COMPANY_SHEETS_CANARY_HEADER,
  COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  COMPANY_SHEETS_CANARY_TAB_TITLE,
  COMPANY_SHEETS_RECONCILE_ROW_CAP,
  companySheetsCampaignHeader,
  isCompanyGoogleSheetsEnabled,
  isCompanySheetsTabRole,
  type CompanySheetsTabRole,
} from "../../lib/company-google-sheets-env.js";
import { getSpreadsheetMetadata, type GoogleSheetsWorksheet } from "../google-sheets/google-sheets-http-client.js";
import { getCompanyDriveFile } from "../company-google/company-google-drive-http.js";
import { getValidCompanyGoogleAccessToken } from "../company-google/company-google-access-token.service.js";
import { establishControl, type CompanySheetsDeps } from "../company-google/company-sheets-destination.service.js";
import { loadAuthorizedAgedDeliverySet } from "./company-sheets-aged-authority.js";
import { addSpreadsheetSheet, type AddedSheet } from "./company-sheets-tab-http.js";
import { getSheetValues, quoteSheetTitle } from "./company-sheets-values-http.js";

type DeliveryFailure = { ok: false; code: string; statusCode: number };

export type CompanySheetsTabDeps = CompanySheetsDeps & {
  getValues?: typeof getSheetValues;
  addSheet?: typeof addSpreadsheetSheet;
};

type SheetPreview = {
  worksheetId: number;
  title: string;
  sheetType: string;
  empty: boolean;
  header: string[];
  classification: "compatible_empty" | "compatible_header" | "incompatible" | "not_grid" | "unclassified";
  reason: string | null;
};

function fail(code: string, statusCode = 409): DeliveryFailure {
  return { ok: false, code, statusCode };
}

function blankRow(row: string[] | undefined): boolean {
  return !row || row.every((cell) => cell.trim() === "");
}

function sameHeader(actual: string[], expected: string[]): boolean {
  if (actual.length < expected.length) return false;
  return expected.every((cell, index) => (actual[index] ?? "") === cell);
}

function titleFor(role: CompanySheetsTabRole): string {
  if (role === "campaign") return COMPANY_SHEETS_CAMPAIGN_TAB_TITLE;
  if (role === "aged") return COMPANY_SHEETS_AGED_TAB_TITLE;
  return COMPANY_SHEETS_CANARY_TAB_TITLE;
}

function campaignContract(schemaVersion: string | null | undefined): { schemaVersion: string; header: string[] } | null {
  const requested = schemaVersion?.trim() || COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION;
  const header = companySheetsCampaignHeader(requested);
  if (!header) return null;
  return { schemaVersion: requested, header: [...header] };
}

function canaryContract(): { schemaVersion: string; header: string[] } {
  return { schemaVersion: COMPANY_SHEETS_CANARY_SCHEMA_VERSION, header: [...COMPANY_SHEETS_CANARY_HEADER] };
}

async function requireDestination(
  clientAccountId: string,
  db: PrismaClient
): Promise<CompanySheetsDestination | DeliveryFailure> {
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: clientAccountId.trim() },
  });
  if (!destination) return fail("destination_not_configured", 404);
  return destination;
}

async function withCompanyFile(
  destination: CompanySheetsDestination,
  deps: CompanySheetsTabDeps,
  env: NodeJS.ProcessEnv,
  db: PrismaClient
): Promise<
  | { ok: true; accessToken: string; worksheets: GoogleSheetsWorksheet[] }
  | DeliveryFailure
> {
  const token = await (deps.getAccessToken ?? getValidCompanyGoogleAccessToken)({
    env,
    db,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!token.ok) return fail(token.code, token.code === "google_not_connected" ? 409 : 503);
  if (token.connectionId !== destination.companyConnectionId) return fail("company_connection_changed", 409);
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: destination.spreadsheetId, accessToken: token.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return fail(metadataResult.reason, 502);
  const connection = await db.companyGoogleConnection.findUnique({ where: { id: destination.companyConnectionId } });
  if (!connection || connection.status !== "connected") return fail("google_not_connected", 409);
  const control = await establishControl(
    {
      connection,
      accessToken: token.accessToken,
      spreadsheetId: destination.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db, getDriveFile: deps.getDriveFile ?? getCompanyDriveFile }
  );
  if (!control.ok) return fail(control.code, control.statusCode);
  return { ok: true, accessToken: token.accessToken, worksheets: metadataResult.metadata.worksheets };
}

async function readPreview(
  destination: CompanySheetsDestination,
  sheet: GoogleSheetsWorksheet,
  expected: { header: string[] } | null,
  accessToken: string,
  deps: CompanySheetsTabDeps
): Promise<SheetPreview | DeliveryFailure> {
  if (sheet.sheetType !== "GRID") {
    return {
      worksheetId: sheet.sheetId,
      title: sheet.title,
      sheetType: sheet.sheetType,
      empty: false,
      header: [],
      classification: "not_grid",
      reason: "worksheet_not_grid",
    };
  }
  const title = quoteSheetTitle(sheet.title);
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: destination.spreadsheetId, range: `${title}!A1:ZZ2`, accessToken },
    deps.fetchImpl
  );
  if (!read.ok) return fail(read.reason, 502);
  const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
  const probe = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: destination.spreadsheetId, range: `${title}!A1:A${cap}`, accessToken },
    deps.fetchImpl
  );
  if (!probe.ok) return fail(probe.reason, 502);
  const first = read.values[0] ?? [];
  const occupied = probe.values.some((row) => (row[0] ?? "").trim() !== "");
  const truncated = probe.values.length >= cap;
  const empty = blankRow(read.values[0]) && blankRow(read.values[1]) && !occupied && !truncated;
  const base = {
    worksheetId: sheet.sheetId,
    title: sheet.title,
    sheetType: sheet.sheetType,
    empty,
    header: empty ? [] : first,
  };
  if (!expected) {
    return {
      ...base,
      classification: "unclassified" as const,
      reason: empty ? null : truncated ? "reconcile_incomplete" : "needs_schema",
    };
  }
  if (!blankRow(first) && sameHeader(first, expected.header)) {
    return { ...base, empty: false, header: first, classification: "compatible_header" as const, reason: null };
  }
  if (empty) {
    return { ...base, classification: "compatible_empty" as const, reason: null };
  }
  const reason = truncated ? "reconcile_incomplete" : blankRow(first) ? "existing_rows" : "header_mismatch";
  return { ...base, empty: false, classification: "incompatible" as const, reason };
}

async function expectedForRole(
  role: CompanySheetsTabRole,
  destination: CompanySheetsDestination,
  exportPackageId: string | null,
  schemaVersion: string | null,
  db: PrismaClient
): Promise<{ ok: true; schemaVersion: string; header: string[] } | DeliveryFailure> {
  if (role === "campaign") {
    const contract = campaignContract(schemaVersion);
    if (!contract) return fail("invalid_schema", 400);
    return { ok: true, ...contract };
  }
  if (role === "canary") {
    if (!destination.canaryApproved) return fail("canary_not_approved", 409);
    return { ok: true, ...canaryContract() };
  }
  if (!exportPackageId) return fail("authorized_export_required", 409);
  const loaded = await loadAuthorizedAgedDeliverySet(db, exportPackageId);
  if (!loaded.ok) return fail(loaded.code, loaded.code === "export_not_found" ? 404 : 409);
  if (loaded.packageRow.clientAccountId !== destination.clientAccountId) return fail("order_client_mismatch", 409);
  return { ok: true, schemaVersion: loaded.schemaVersion, header: loaded.header };
}

async function persistContract(
  db: PrismaClient,
  destination: CompanySheetsDestination,
  role: CompanySheetsTabRole,
  data: {
    setupState: string;
    setupReason: string | null;
    worksheetId: number | null;
    worksheetTitle: string | null;
    schemaVersion: string | null;
    headerContract: Prisma.InputJsonValue;
    boundAt: Date | null;
    inspectedAt: Date | null;
  },
  bumpRevision: boolean
): Promise<CompanySheetsTabContract> {
  const saved = await db.$transaction(async (tx) => {
    const row = await tx.companySheetsTabContract.upsert({
      where: { destinationId_role: { destinationId: destination.id, role } },
      create: {
        destinationId: destination.id,
        role,
        setupState: data.setupState,
        setupReason: data.setupReason,
        worksheetId: data.worksheetId,
        worksheetTitle: data.worksheetTitle,
        schemaVersion: data.schemaVersion,
        headerContract: data.headerContract,
        boundAt: data.boundAt,
        inspectedAt: data.inspectedAt,
      },
      update: data,
    });
    if (bumpRevision) {
      await tx.companySheetsDestination.update({
        where: { id: destination.id },
        data: { destinationRevision: { increment: 1 } },
      });
    }
    return row;
  });
  return saved;
}

function presentContract(row: CompanySheetsTabContract | null, role: CompanySheetsTabRole) {
  return {
    role,
    setupState: row?.setupState ?? "missing",
    setupReason: row?.setupReason ?? (row ? null : "tab_missing"),
    worksheetId: row?.worksheetId ?? null,
    worksheetTitle: row?.worksheetTitle ?? null,
    schemaVersion: row?.schemaVersion ?? null,
    boundAt: row?.boundAt?.toISOString() ?? null,
    inspectedAt: row?.inspectedAt?.toISOString() ?? null,
  };
}

export async function listCompanySheetsTabContracts(
  clientAccountId: string,
  deps: CompanySheetsTabDeps = {}
) {
  const db = deps.db ?? prisma;
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: clientAccountId.trim() },
  });
  if (!destination) return { ok: true as const, destination: null, contracts: [] };
  const rows = await db.companySheetsTabContract.findMany({ where: { destinationId: destination.id } });
  return {
    ok: true as const,
    destinationRevision: destination.destinationRevision,
    contracts: (["campaign", "aged", "canary"] as const).map((role) =>
      presentContract(rows.find((row) => row.role === role) ?? null, role)
    ),
  };
}

export async function inspectCompanySheetsTabs(
  clientAccountId: string,
  input: { exportPackageId?: string | null },
  deps: CompanySheetsTabDeps = {}
): Promise<
  | {
      ok: true;
      contracts: ReturnType<typeof presentContract>[];
      worksheets: SheetPreview[];
      googleMutations: 0;
    }
  | DeliveryFailure
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled", 404);
  const db = deps.db ?? prisma;
  const destination = await requireDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const file = await withCompanyFile(destination, deps, env, db);
  if (!file.ok) return file;
  const agedExpected = input.exportPackageId
    ? await expectedForRole("aged", destination, input.exportPackageId, null, db)
    : null;
  if (agedExpected && !agedExpected.ok) return agedExpected;
  const stored = await db.companySheetsTabContract.findMany({ where: { destinationId: destination.id } });
  const worksheets: SheetPreview[] = [];
  for (const sheet of file.worksheets) {
    const preview = await readPreview(destination, sheet, null, file.accessToken, deps);
    if (!("worksheetId" in preview)) return preview;
    worksheets.push(preview);
  }
  const now = deps.now?.() ?? new Date();
  for (const row of stored) {
    if (!isCompanySheetsTabRole(row.role) || row.setupState !== "bound" || row.worksheetId == null) continue;
    const sheet = file.worksheets.find((item) => item.sheetId === row.worksheetId);
    const expectedHeader = Array.isArray(row.headerContract)
      ? row.headerContract.filter((cell): cell is string => typeof cell === "string")
      : [];
    if (!sheet || expectedHeader.length === 0) {
      await persistContract(
        db,
        destination,
        row.role,
        {
          setupState: "incompatible",
          setupReason: "worksheet_missing",
          worksheetId: row.worksheetId,
          worksheetTitle: row.worksheetTitle,
          schemaVersion: row.schemaVersion,
          headerContract: expectedHeader,
          boundAt: null,
          inspectedAt: now,
        },
        true
      );
      continue;
    }
    const classified = await readPreview(
      destination,
      sheet,
      { header: expectedHeader },
      file.accessToken,
      deps
    );
    if (!("worksheetId" in classified)) return classified;
    if (classified.classification !== "compatible_empty" && classified.classification !== "compatible_header") {
      await persistContract(
        db,
        destination,
        row.role,
        {
          setupState: "incompatible",
          setupReason: classified.reason ?? "header_mismatch",
          worksheetId: sheet.sheetId,
          worksheetTitle: sheet.title,
          schemaVersion: row.schemaVersion,
          headerContract: expectedHeader,
          boundAt: null,
          inspectedAt: now,
        },
        true
      );
    } else {
      await persistContract(
        db,
        destination,
        row.role,
        {
          setupState: "bound",
          setupReason: null,
          worksheetId: sheet.sheetId,
          worksheetTitle: sheet.title,
          schemaVersion: row.schemaVersion,
          headerContract: expectedHeader,
          boundAt: row.boundAt,
          inspectedAt: now,
        },
        false
      );
    }
  }
  const refreshed = await db.companySheetsTabContract.findMany({ where: { destinationId: destination.id } });
  return {
    ok: true,
    googleMutations: 0,
    contracts: (["campaign", "aged", "canary"] as const).map((role) =>
      presentContract(refreshed.find((row) => row.role === role) ?? null, role)
    ),
    worksheets: worksheets.map((sheet) => {
      if (!agedExpected || !agedExpected.ok) return sheet;
      const classified = classifyAgainst(sheet, agedExpected.header);
      return classified;
    }),
  };
}

function classifyAgainst(sheet: SheetPreview, header: string[]): SheetPreview {
  if (sheet.classification === "not_grid") return sheet;
  if (sheet.empty) return { ...sheet, classification: "compatible_empty", reason: null };
  if (sameHeader(sheet.header, header)) return { ...sheet, classification: "compatible_header", reason: null };
  return { ...sheet, classification: "incompatible", reason: sheet.reason ?? "header_mismatch" };
}

export async function bindCompanySheetsTab(
  clientAccountId: string,
  input: { role: string; worksheetId: number; exportPackageId?: string | null; schemaVersion?: string | null },
  deps: CompanySheetsTabDeps = {}
): Promise<{ ok: true; contract: ReturnType<typeof presentContract>; destinationRevision: number } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled", 404);
  if (!isCompanySheetsTabRole(input.role)) return fail("invalid_tab_role", 400);
  if (!Number.isInteger(input.worksheetId) || input.worksheetId < 0) return fail("invalid_worksheet", 400);
  const db = deps.db ?? prisma;
  const destination = await requireDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const stored = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: destination.id, role: input.role } },
  });
  const expected = await expectedForRole(input.role, destination, input.exportPackageId ?? null, input.schemaVersion ?? null, db);
  if (!expected.ok) return expected;
  if (
    stored?.setupState === "bound" &&
    stored.schemaVersion &&
    stored.schemaVersion !== expected.schemaVersion
  ) {
    return fail("schema_change_not_allowed", 409);
  }
  const file = await withCompanyFile(destination, deps, env, db);
  if (!file.ok) return file;
  const sheet = file.worksheets.find((item) => item.sheetId === input.worksheetId);
  if (!sheet) return fail("worksheet_unavailable", 409);
  const preview = await readPreview(destination, sheet, expected, file.accessToken, deps);
  if (!("worksheetId" in preview)) return preview;
  const now = deps.now?.() ?? new Date();
  if (preview.classification !== "compatible_empty" && preview.classification !== "compatible_header") {
    await persistContract(
      db,
      destination,
      input.role,
      {
        setupState: "incompatible",
        setupReason: preview.reason ?? "header_mismatch",
        worksheetId: sheet.sheetId,
        worksheetTitle: sheet.title,
        schemaVersion: expected.schemaVersion,
        headerContract: expected.header,
        boundAt: null,
        inspectedAt: now,
      },
      true
    );
    return fail("tab_incompatible", 409);
  }
  await persistContract(
    db,
    destination,
    input.role,
    {
      setupState: "bound",
      setupReason: null,
      worksheetId: sheet.sheetId,
      worksheetTitle: sheet.title,
      schemaVersion: expected.schemaVersion,
      headerContract: expected.header,
      boundAt: now,
      inspectedAt: now,
    },
    true
  );
  const updated = await db.companySheetsDestination.findUniqueOrThrow({ where: { id: destination.id } });
  const row = await db.companySheetsTabContract.findUniqueOrThrow({
    where: { destinationId_role: { destinationId: destination.id, role: input.role } },
  });
  return { ok: true, contract: presentContract(row, input.role), destinationRevision: updated.destinationRevision };
}

export async function createMissingCompanySheetsTab(
  clientAccountId: string,
  input: { role: string; exportPackageId?: string | null; schemaVersion?: string | null },
  deps: CompanySheetsTabDeps = {}
): Promise<
  | { ok: true; contract: ReturnType<typeof presentContract>; createdSheet: AddedSheet; destinationRevision: number }
  | DeliveryFailure
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled", 404);
  if (!isCompanySheetsTabRole(input.role)) return fail("invalid_tab_role", 400);
  const db = deps.db ?? prisma;
  const destination = await requireDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const existing = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: destination.id, role: input.role } },
  });
  if (existing?.setupState === "bound") return fail("tab_already_bound", 409);
  const expected = await expectedForRole(input.role, destination, input.exportPackageId ?? null, input.schemaVersion ?? null, db);
  if (!expected.ok) return expected;
  const file = await withCompanyFile(destination, deps, env, db);
  if (!file.ok) return file;
  const title = titleFor(input.role);
  if (file.worksheets.some((sheet) => sheet.title === title)) return fail("tab_title_exists", 409);
  const created = await (deps.addSheet ?? addSpreadsheetSheet)(
    { spreadsheetId: destination.spreadsheetId, title, accessToken: file.accessToken },
    deps.fetchImpl
  );
  if (!created.ok) {
    if (created.reason === "network_error" || created.reason === "server_error" || created.reason === "malformed_response") {
      return fail("create_outcome_unknown", 409);
    }
    return fail(created.reason, 502);
  }
  const now = deps.now?.() ?? new Date();
  await persistContract(
    db,
    destination,
    input.role,
    {
      setupState: "bound",
      setupReason: null,
      worksheetId: created.sheet.worksheetId,
      worksheetTitle: created.sheet.worksheetTitle,
      schemaVersion: expected.schemaVersion,
      headerContract: expected.header,
      boundAt: now,
      inspectedAt: now,
    },
    true
  );
  const updated = await db.companySheetsDestination.findUniqueOrThrow({ where: { id: destination.id } });
  const row = await db.companySheetsTabContract.findUniqueOrThrow({
    where: { destinationId_role: { destinationId: destination.id, role: input.role } },
  });
  return {
    ok: true,
    contract: presentContract(row, input.role),
    createdSheet: created.sheet,
    destinationRevision: updated.destinationRevision,
  };
}
