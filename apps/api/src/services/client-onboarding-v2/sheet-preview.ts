/**
 * Read-only Drive discovery and worksheet classification.
 * Search and preview do not create files, bind tabs, or write cells.
 */

import { COMPANY_SHEETS_V3_HEADER, companySheetsV3HeaderMatches } from "@sa360/shared";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_GOOGLE_DRIVE_FILES_URL,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_RECONCILE_ROW_CAP,
  companySheetsCampaignHeader,
  isCompanyGoogleSheetsEnabled,
  readCompanyStorageConfig,
} from "../../lib/company-google-sheets-env.js";
import { parseGoogleSpreadsheetRef } from "../../lib/google-spreadsheet-ref.js";
import { findClientForCompanySheets } from "../../repositories/company-sheets-destination.repository.js";
import {
  findCompanyDriveNamedChild,
  parseCompanyDriveFile,
  type CompanyDriveFile,
} from "../company-google/company-google-drive-http.js";
import {
  COMPANY_DRIVE_FOLDER_MIME,
  COMPANY_DRIVE_SHORTCUT_MIME,
  COMPANY_DRIVE_SPREADSHEET_MIME,
} from "../company-google/company-google-storage-policy.js";
import {
  establishControl,
  loadReadyConnection,
  resolveCompanyClientFolder,
  type CompanySheetsDeps,
  type CompanySheetsFailure,
} from "../company-google/company-sheets-destination.service.js";
import { getSpreadsheetMetadata, type GoogleSheetsWorksheet } from "../google-sheets/google-sheets-http-client.js";
import { getSheetValues, quoteSheetTitle } from "../company-sheets-dispatch/company-sheets-onboarding-read.js";

const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,128}$/;
const DRIVE_LIST_FIELDS =
  "id,name,mimeType,ownedByMe,driveId,parents,trashed,shortcutDetails(targetId),owners(emailAddress),capabilities(canEdit,canAddChildren)";
const PAGE_SIZE = 20;
const STATS_TITLES = new Set(["daily stats", "weekly stats"]);

export type OnboardingSheetClassification =
  | "v3_exact_header"
  | "v3_prefix_with_extra_columns"
  | "known_schema_exact"
  | "compatible_empty"
  | "legacy_custom_required"
  | "stats_excluded"
  | "not_grid"
  | "incompatible";

export type OnboardingWorksheetPreview = {
  worksheetId: number;
  title: string;
  grid: boolean;
  header: string[];
  headerColumnCount: number;
  historicalDataRows: "empty" | "has_rows" | "truncated";
  historicalDataRowCount?: number;
  classification: OnboardingSheetClassification;
  fastPath: boolean;
  deliveryEligible: boolean;
  requiresExplicitSelection: boolean;
  headerDrift: boolean;
  sampleRow: string[];
  reasons: string[];
};

export type OnboardingSheetDeps = CompanySheetsDeps & {
  establishControl?: typeof establishControl;
  getValues?: typeof getSheetValues;
  findNamedChild?: typeof findCompanyDriveNamedChild;
  resolveFolder?: typeof resolveCompanyClientFolder;
};

export type OnboardingReadFailure = {
  ok: false;
  code: string;
  statusCode: number;
  retryable?: boolean;
};

type DriveSearchItem = {
  id: string;
  title: string;
  mimeType: string;
  kind: "folder" | "spreadsheet" | "shortcut";
  driveId: string | null;
  parents: string[];
  trashed: boolean;
  shortcut: boolean;
  selectable: boolean;
  selected: false;
  reason: string | null;
};

export function isStatsWorksheetTitle(title: string): boolean {
  return STATS_TITLES.has(title.trim().toLowerCase());
}

/**
 * Drive list URL for one approved parent page.
 * The operator query is not a parameter: it is applied after the response returns.
 */
export function buildOnboardingDriveSearchUrl(input: {
  parentId: string;
  driveId: string;
  pageToken?: string | null;
}): string {
  assertDriveId(input.parentId);
  assertDriveId(input.driveId);
  const query = [
    `'${input.parentId}' in parents`,
    `(mimeType = '${COMPANY_DRIVE_FOLDER_MIME}' or mimeType = '${COMPANY_DRIVE_SPREADSHEET_MIME}' or mimeType = '${COMPANY_DRIVE_SHORTCUT_MIME}')`,
  ].join(" and ");
  const parts = [
    `${COMPANY_GOOGLE_DRIVE_FILES_URL}?q=${encodeURIComponent(query)}`,
    "supportsAllDrives=true",
    "includeItemsFromAllDrives=true",
    "corpora=drive",
    `driveId=${encodeURIComponent(input.driveId)}`,
    `pageSize=${PAGE_SIZE}`,
    `fields=${encodeURIComponent(`files(${DRIVE_LIST_FIELDS}),nextPageToken`)}`,
  ];
  const pageToken = input.pageToken?.trim();
  if (pageToken) parts.push(`pageToken=${encodeURIComponent(pageToken)}`);
  const url = parts.join("&");
  if (!url.startsWith(`${COMPANY_GOOGLE_DRIVE_FILES_URL}?`)) {
    throw new Error("Onboarding Drive search refused a non-file URL.");
  }
  if (url.includes("sheets.googleapis.com") || url.includes("/permissions") || url.includes(":append")) {
    throw new Error("Onboarding Drive search refused a write URL.");
  }
  return url;
}

export function classifyOnboardingWorksheet(input: {
  worksheetId: number;
  title: string;
  sheetType: string;
  header: string[];
  columnA: string[][];
}): OnboardingWorksheetPreview {
  const header = input.header.map((cell) => (cell == null ? "" : String(cell)));
  const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
  const truncated = input.columnA.length >= cap;
  const dataCount = input.columnA.slice(1).filter((row) => (row[0] ?? "").trim() !== "").length;
  const historicalDataRows = truncated ? "truncated" : dataCount > 0 ? "has_rows" : "empty";
  const grid = input.sheetType === "GRID";
  const reasons: string[] = [];
  if (isStatsWorksheetTitle(input.title)) {
    return worksheet(input, {
      grid,
      header,
      historicalDataRows,
      historicalDataRowCount: truncated ? undefined : dataCount,
      classification: "stats_excluded",
      fastPath: false,
      deliveryEligible: false,
      reasons: ["stats_excluded"],
    });
  }
  if (!grid) {
    return worksheet(input, {
      grid: false,
      header,
      historicalDataRows,
      historicalDataRowCount: truncated ? undefined : dataCount,
      classification: "not_grid",
      fastPath: false,
      deliveryEligible: false,
      reasons: ["worksheet_not_grid"],
    });
  }
  const classification = classifyHeader(header, historicalDataRows, reasons);
  if (truncated) reasons.push("reconcile_incomplete");
  const fastPath = classification === "v3_exact_header" && !truncated;
  const deliveryEligible =
    !truncated &&
    (classification === "v3_exact_header" ||
      classification === "known_schema_exact" ||
      classification === "compatible_empty");
  return worksheet(input, {
    grid: true,
    header,
    historicalDataRows,
    historicalDataRowCount: truncated ? undefined : dataCount,
    classification,
    fastPath,
    deliveryEligible,
    reasons,
  });
}

export async function resolveOnboardingFolder(
  clientAccountId: string,
  folder: unknown,
  deps: OnboardingSheetDeps = {}
): Promise<
  | { ok: true; saved: false; folder: { folderId: string; title: string; driveId: string | null; basis: string } }
  | OnboardingReadFailure
> {
  const disabled = sheetsDisabled(deps.env ?? process.env);
  if (disabled) return disabled;
  const resolver = deps.resolveFolder ?? resolveCompanyClientFolder;
  const resolved = await resolver(clientAccountId, folder, deps);
  if (!resolved.ok) return fromSheets(resolved);
  return { ok: true, saved: false, folder: resolved.folder };
}

export async function searchOnboardingDrive(
  clientAccountId: string,
  input: { scope: "approved_parent" | "client_folder"; query: string; pageToken?: string | null },
  deps: OnboardingSheetDeps = {}
): Promise<
  | {
      ok: true;
      saved: false;
      items: DriveSearchItem[];
      suggestions: DriveSearchItem[];
      nameMatch: "none" | "unique" | "ambiguous";
      selectedFolderId: null;
      nextPageToken: string | null;
    }
  | OnboardingReadFailure
> {
  const env = deps.env ?? process.env;
  const disabled = sheetsDisabled(env);
  if (disabled) return disabled;
  const query = input.query.trim();
  if (!query || query.length > 80 || containsControl(query)) return invalidRequest();
  const pageToken = input.pageToken?.trim() || null;
  if (pageToken && (pageToken.length > 512 || containsControl(pageToken))) return invalidRequest();
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return notFound("client_not_found");
  const config = readCompanyStorageConfig(env);
  if (!config.approvedSharedDriveId || !config.approvedParentFolderId) {
    return { ok: false, code: "approved_parent_unconfigured", statusCode: 409, retryable: false };
  }
  let parentId = config.approvedParentFolderId;
  if (input.scope === "client_folder") {
    const stored = await db.companySheetsClientFolder.findUnique({ where: { clientAccountId: client.clientAccountId } });
    if (!stored?.folderId || stored.status !== "active") return notFound("folder_unavailable");
    const resolved = await (deps.resolveFolder ?? resolveCompanyClientFolder)(client.clientAccountId, stored.folderId, {
      ...deps,
      env,
      db,
    });
    if (!resolved.ok) return fromSheets(resolved);
    if (resolved.folder.driveId !== config.approvedSharedDriveId) {
      return { ok: false, code: "unapproved_shared_drive", statusCode: 409, retryable: false };
    }
    parentId = resolved.folder.folderId;
  }
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return fromSheets(ready);
  const listed = await listOnboardingDrivePage(
    {
      parentId,
      driveId: config.approvedSharedDriveId,
      accessToken: ready.accessToken,
      pageToken,
    },
    deps.fetchImpl
  );
  if (!listed.ok) return { ok: false, code: listed.reason, statusCode: 502, retryable: listed.reason !== "invalid_request" };
  const folderTitle = sanitizeFolderTitle(client.clientDisplayName);
  const suggestions = await clientNameSuggestions(
    folderTitle,
    config.approvedParentFolderId,
    config.approvedSharedDriveId,
    ready.accessToken,
    deps
  );
  if (!suggestions.ok) return suggestions.failure;
  const items: DriveSearchItem[] = [];
  for (const file of listed.files) {
    if (!file.name.toLowerCase().includes(query.toLowerCase())) continue;
    items.push(await presentSearchFile(file, parentId, config.approvedSharedDriveId, ready, deps));
  }
  return {
    ok: true,
    saved: false,
    items,
    suggestions: suggestions.items,
    nameMatch: suggestions.nameMatch,
    selectedFolderId: null,
    nextPageToken: listed.nextPageToken,
  };
}

export async function previewOnboardingSpreadsheet(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetTitle?: string; worksheetId?: number },
  deps: OnboardingSheetDeps = {}
): Promise<
  | {
      ok: true;
      saved: false;
      spreadsheetId: string;
      spreadsheetTitle: string;
      recommendation: {
        worksheetId: number;
        title: string;
        classification: "v3_exact_header";
        fastPath: true;
        selected: false;
        bound: false;
        existingBinding: boolean;
        requiresExplicitSelection: true;
      } | null;
      selection: { worksheetTitle: string | null; worksheetId: number | null; applied: false; bound: false } | null;
      worksheets: OnboardingWorksheetPreview[];
    }
  | OnboardingReadFailure
> {
  const env = deps.env ?? process.env;
  const disabled = sheetsDisabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return notFound("client_not_found");
  if (input.worksheetTitle && isStatsWorksheetTitle(input.worksheetTitle)) {
    return { ok: false, code: "stats_tab_not_a_delivery_target", statusCode: 422 };
  }
  const parsed = parseGoogleSpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return { ok: false, code: "invalid_spreadsheet_ref", statusCode: 400, retryable: false };
  const owner = await db.companySheetsDestination.findUnique({
    where: { spreadsheetId: parsed.spreadsheetId },
    include: { tabContracts: true },
  });
  if (owner && owner.clientAccountId !== client.clientAccountId) {
    return { ok: false, code: "tenant_mismatch", statusCode: 403, retryable: false };
  }
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return fromSheets(ready);
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: parsed.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return { ok: false, code: metadataResult.reason, statusCode: 502, retryable: true };
  const control = await (deps.establishControl ?? establishControl)(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: parsed.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db }
  );
  if (!control.ok) return fromSheets(control);
  const storedHeader = headerByWorksheet(owner?.tabContracts ?? []);
  const worksheets: OnboardingWorksheetPreview[] = [];
  for (const sheet of metadataResult.metadata.worksheets) {
    const read = await readWorksheet(parsed.spreadsheetId, sheet, ready.accessToken, deps);
    if (!read.ok) return read.failure;
    const classified = classifyOnboardingWorksheet({
      worksheetId: sheet.sheetId,
      title: sheet.title,
      sheetType: sheet.sheetType,
      header: read.header,
      columnA: read.columnA,
    });
    const stored = storedHeader.get(sheet.sheetId);
    if (stored && !exactCells(stored, classified.header)) {
      classified.headerDrift = true;
      classified.reasons = [...classified.reasons, "header_changed"];
    }
    classified.sampleRow = read.sampleRow;
    worksheets.push(classified);
  }
  if (input.worksheetId != null) {
    const selected = worksheets.find((sheet) => sheet.worksheetId === input.worksheetId);
    if (selected && selected.classification === "stats_excluded") {
      return { ok: false, code: "stats_tab_not_a_delivery_target", statusCode: 422 };
    }
  }
  const campaignMatches = worksheets.filter(
    (sheet) =>
      sheet.classification === "v3_exact_header" &&
      sheet.fastPath &&
      sheet.title.trim().toLowerCase() === "campaign leads"
  );
  const campaignContract = (owner?.tabContracts ?? []).find((contract) => contract.role === "campaign");
  const recommendation =
    campaignMatches.length === 1
      ? {
          worksheetId: campaignMatches[0]!.worksheetId,
          title: campaignMatches[0]!.title,
          classification: "v3_exact_header" as const,
          fastPath: true as const,
          selected: false as const,
          bound: false as const,
          existingBinding: Boolean(
            campaignContract &&
              campaignContract.setupState === "bound" &&
              campaignContract.worksheetId === campaignMatches[0]!.worksheetId
          ),
          requiresExplicitSelection: true as const,
        }
      : null;
  return {
    ok: true,
    saved: false,
    spreadsheetId: metadataResult.metadata.spreadsheetId,
    spreadsheetTitle: metadataResult.metadata.title,
    recommendation,
    selection:
      input.worksheetTitle || input.worksheetId != null
        ? {
            worksheetTitle: input.worksheetTitle ?? null,
            worksheetId: input.worksheetId ?? null,
            applied: false,
            bound: false,
          }
        : null,
    worksheets,
  };
}

function worksheet(
  input: { worksheetId: number; title: string },
  fields: Omit<
    OnboardingWorksheetPreview,
    "worksheetId" | "title" | "headerColumnCount" | "requiresExplicitSelection" | "headerDrift" | "sampleRow"
  >
): OnboardingWorksheetPreview {
  return {
    worksheetId: input.worksheetId,
    title: input.title,
    headerColumnCount: fields.header.length,
    requiresExplicitSelection: fields.deliveryEligible,
    headerDrift: false,
    sampleRow: [],
    ...fields,
  };
}

function classifyHeader(
  header: string[],
  historicalDataRows: "empty" | "has_rows" | "truncated",
  reasons: string[]
): OnboardingSheetClassification {
  const v3 = COMPANY_SHEETS_V3_HEADER;
  if (header.length === v3.length && v3.every((cell, index) => header[index] === cell)) return "v3_exact_header";
  if (header.length > v3.length && companySheetsV3HeaderMatches(header)) return "v3_prefix_with_extra_columns";
  for (const version of [COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION, COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2]) {
    const expected = companySheetsCampaignHeader(version);
    if (expected && exactCells(header, [...expected])) return "known_schema_exact";
  }
  if (blankHeader(header) && historicalDataRows === "empty") return "compatible_empty";
  if (blankHeader(header)) {
    reasons.push(historicalDataRows === "truncated" ? "reconcile_incomplete" : "existing_rows");
    return "incompatible";
  }
  return "legacy_custom_required";
}

async function readWorksheet(
  spreadsheetId: string,
  sheet: GoogleSheetsWorksheet,
  accessToken: string,
  deps: OnboardingSheetDeps
): Promise<{ ok: true; header: string[]; sampleRow: string[]; columnA: string[][] } | { ok: false; failure: OnboardingReadFailure }> {
  const title = quoteSheetTitle(sheet.title);
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId, range: `${title}!A1:ZZ2`, accessToken },
    deps.fetchImpl
  );
  if (!read.ok) return { ok: false, failure: { ok: false, code: read.reason, statusCode: 502, retryable: true } };
  const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
  const probe = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId, range: `${title}!A1:A${cap}`, accessToken },
    deps.fetchImpl
  );
  if (!probe.ok) return { ok: false, failure: { ok: false, code: probe.reason, statusCode: 502, retryable: true } };
  return { ok: true, header: read.values[0] ?? [], sampleRow: read.values[1] ?? [], columnA: probe.values };
}

async function listOnboardingDrivePage(
  input: { parentId: string; driveId: string; accessToken: string; pageToken: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; files: CompanyDriveFile[]; nextPageToken: string | null } | { ok: false; reason: string }> {
  const url = buildOnboardingDriveSearchUrl(input);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (!response.ok) return { ok: false, reason: "provider_error" };
  const json = (await response.json()) as { files?: unknown; nextPageToken?: unknown };
  if (!Array.isArray(json.files)) return { ok: false, reason: "malformed_response" };
  const files: CompanyDriveFile[] = [];
  for (const item of json.files) {
    const file = parseCompanyDriveFile(item);
    if (file) files.push(file);
  }
  const nextPageToken = typeof json.nextPageToken === "string" && json.nextPageToken ? json.nextPageToken : null;
  return { ok: true, files, nextPageToken };
}

async function presentSearchFile(
  file: CompanyDriveFile,
  parentId: string,
  approvedDriveId: string,
  ready: { connection: Parameters<typeof establishControl>[0]["connection"]; accessToken: string },
  deps: OnboardingSheetDeps
): Promise<DriveSearchItem> {
  const shortcut = file.mimeType === COMPANY_DRIVE_SHORTCUT_MIME || Boolean(file.shortcutTargetId);
  const trashed = file.trashed === true;
  const kind: DriveSearchItem["kind"] = shortcut
    ? "shortcut"
    : file.mimeType === COMPANY_DRIVE_FOLDER_MIME
      ? "folder"
      : "spreadsheet";
  const base = {
    id: file.id,
    title: file.name,
    mimeType: file.mimeType,
    kind,
    driveId: file.driveId,
    parents: file.parents,
    trashed,
    shortcut,
    selected: false as const,
  };
  if (shortcut) return { ...base, selectable: false, reason: "shortcut_bypass" };
  if (trashed) return { ...base, selectable: false, reason: "trashed_file" };
  if (file.driveId !== approvedDriveId) return { ...base, selectable: false, reason: "unapproved_shared_drive" };
  if (!file.parents.includes(parentId)) return { ...base, selectable: false, reason: "outside_approved_parent" };
  if (kind !== "spreadsheet") return { ...base, selectable: true, reason: null };
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: file.id, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return { ...base, selectable: false, reason: metadataResult.reason };
  const control = await (deps.establishControl ?? establishControl)(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: file.id,
      metadata: metadataResult.metadata,
    },
    deps
  );
  if (!control.ok) return { ...base, selectable: false, reason: control.code };
  return { ...base, selectable: true, reason: null };
}

async function clientNameSuggestions(
  folderTitle: string | null,
  parentId: string,
  driveId: string,
  accessToken: string,
  deps: OnboardingSheetDeps
): Promise<
  | { ok: true; items: DriveSearchItem[]; nameMatch: "none" | "unique" | "ambiguous" }
  | { ok: false; failure: OnboardingReadFailure }
> {
  if (!folderTitle) return { ok: true, items: [], nameMatch: "none" };
  const named = await (deps.findNamedChild ?? findCompanyDriveNamedChild)(
    { parentId, name: folderTitle, mimeType: COMPANY_DRIVE_FOLDER_MIME, driveId, accessToken },
    deps.fetchImpl
  );
  if (!named.ok && named.reason !== "ambiguous") {
    return { ok: false, failure: { ok: false, code: named.reason, statusCode: 502, retryable: false } };
  }
  const files = named.ok ? named.files : (named.files ?? []);
  const items = files.map((file) => ({
    id: file.id,
    title: file.name,
    mimeType: file.mimeType,
    kind: "folder" as const,
    driveId: file.driveId,
    parents: file.parents,
    trashed: false,
    shortcut: false,
    selectable: true,
    selected: false as const,
    reason: null,
  }));
  const nameMatch = !named.ok || items.length > 1 ? "ambiguous" : items.length === 1 ? "unique" : "none";
  return { ok: true, items, nameMatch };
}

function headerByWorksheet(
  contracts: Array<{ worksheetId: number | null; headerContract: unknown }>
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const contract of contracts) {
    if (contract.worksheetId == null || !Array.isArray(contract.headerContract)) continue;
    if (!contract.headerContract.every((cell) => typeof cell === "string")) continue;
    map.set(contract.worksheetId, contract.headerContract);
  }
  return map;
}

function exactCells(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((cell, index) => actual[index] === cell);
}

function blankHeader(header: string[]): boolean {
  return header.length === 0 || header.every((cell) => cell.trim() === "");
}

function sanitizeFolderTitle(displayName: string): string | null {
  const title = displayName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || title.length > 200) return null;
  return title;
}

function assertDriveId(value: string): void {
  if (!DRIVE_ID_PATTERN.test(value)) throw new Error("Onboarding Drive search refused an unvalidated id.");
}

function containsControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function sheetsDisabled(env: NodeJS.ProcessEnv): OnboardingReadFailure | null {
  if (isCompanyGoogleSheetsEnabled(env)) return null;
  return { ok: false, code: "destination_disabled", statusCode: 404, retryable: false };
}

function invalidRequest(): OnboardingReadFailure {
  return { ok: false, code: "invalid_request", statusCode: 400, retryable: false };
}

function notFound(code: string): OnboardingReadFailure {
  return { ok: false, code, statusCode: 404, retryable: false };
}

function fromSheets(result: CompanySheetsFailure): OnboardingReadFailure {
  return { ok: false, code: result.code, statusCode: result.statusCode, retryable: result.retryable };
}
