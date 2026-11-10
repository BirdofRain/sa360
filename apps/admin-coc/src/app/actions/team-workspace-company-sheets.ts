"use server";

import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  fetchCompanyGoogleConnection,
  fetchCompanySheetsDestination,
  fetchCompanySheetsDispatch,
  fetchCompanySheetsTabContracts,
  listCompanyClientSpreadsheets,
  prepareCompanyClientFolder,
  resolveCompanyClientFolder,
  resolveCompanySpreadsheet,
  reviewCompanySheetsColumns,
} from "@/lib/admin-api/company-google-sheets";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";
import {
  companySheetsDiscoveryError,
  type CompanySheetsConnectionSnapshot,
  type CompanySheetsContractSnapshot,
  type CompanySheetsDestinationSnapshot,
  type CompanySheetsDiscoverySnapshot,
  type CompanySheetsDispatchSnapshot,
  type CompanySheetsMappingSnapshot,
  type CompanySheetsStorageSnapshot,
  type CompanySheetsWorksheetReadSnapshot,
} from "@/lib/team-workspace/company-sheets-discovery";
import { isTeamWorkspaceEnabled, isTeamWorkspaceServerEnabled } from "@/lib/team-workspace/config";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";

type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; body: string };

export type CompanySheetsDiscoveryActionResult = {
  ok: boolean;
  code: string;
  message: string | null;
  uncertain: boolean;
  snapshot: CompanySheetsDiscoverySnapshot | null;
  nextPageToken: string | null;
};

export type CompanySheetsWorksheetActionResult = {
  ok: boolean;
  code: string;
  message: string | null;
  uncertain: boolean;
  read: CompanySheetsWorksheetReadSnapshot | null;
};

export type CompanySheetsPageActionResult = {
  ok: boolean;
  code: string;
  message: string | null;
  uncertain: boolean;
  spreadsheets: Array<{ spreadsheetId: string; title: string }>;
  skipped: number;
  nextPageToken: string | null;
};

function disabledMessage(): string | null {
  if (!isTeamWorkspaceEnabled() || !isTeamWorkspaceServerEnabled()) {
    return "Team Workspace is turned off. Company Sheets was not read, and delivery was not turned on.";
  }
  if (!isNativeClientSetupEnabled()) {
    return "Client setup is turned off. Company Sheets was not read, and delivery was not turned on.";
  }
  return null;
}

async function authorize(clientAccountId: string): Promise<CompanySheetsDiscoveryActionResult | null> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const message = disabledMessage();
  if (!message) return null;
  return {
    ok: false,
    code: "FEATURE_DISABLED",
    message,
    uncertain: false,
    snapshot: baseSnapshot(clientAccountId.trim(), message),
    nextPageToken: null,
  };
}

function baseSnapshot(clientAccountId: string, disabledReason: string | null): CompanySheetsDiscoverySnapshot {
  return {
    clientAccountId,
    disabledReason,
    uncertain: false,
    loadError: null,
    connection: null,
    destination: null,
    contracts: [],
    dispatch: null,
    mapping: null,
    mappingError: null,
    storage: null,
    worksheetRead: null,
    selection: { spreadsheetId: null, worksheetId: null },
  };
}

function readErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error !== "string" || !/^[a-z0-9_]{1,64}$/.test(parsed.error)) return null;
    return parsed.error;
  } catch {
    return null;
  }
}

function readFailure(
  clientAccountId: string,
  result: { ok: false; status: number; body: string }
): CompanySheetsDiscoveryActionResult {
  const failure = failureOf(result);
  const message = companySheetsDiscoveryError(failure.code);
  return {
    ok: false,
    code: failure.code,
    message,
    uncertain: failure.uncertain,
    snapshot: { ...baseSnapshot(clientAccountId, null), loadError: message, uncertain: failure.uncertain },
    nextPageToken: null,
  };
}

function failureOf(result: { ok: false; status: number; body: string }): { code: string; uncertain: boolean } {
  if (result.status === 401 || result.status === 403) return { code: "forbidden", uncertain: false };
  if (result.status === 0 || result.status >= 500) {
    const code = readErrorCode(result.body);
    if (code === "oauth_not_configured") return { code, uncertain: false };
    return { code: code === "retryable" ? "retryable" : "retryable", uncertain: code == null };
  }
  const code = readErrorCode(result.body);
  if (!code) return { code: "provider_error", uncertain: true };
  return { code, uncertain: false };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function parseConnection(data: unknown): CompanySheetsConnectionSnapshot | null {
  const root = asRecord(data);
  const row = asRecord(root?.connection);
  if (!row || typeof row.status !== "string" || typeof row.configured !== "boolean") return null;
  const folder = asRecord(row.destinationFolder);
  const missing = Array.isArray(row.missingScopes)
    ? row.missingScopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  return {
    configured: row.configured,
    status: row.status,
    connected: row.connected === true,
    reconnectRequired: row.reconnectRequired === true,
    googleEmail: text(row.googleEmail),
    googleDisplayName: text(row.googleDisplayName),
    missingScopes: missing,
    destinationFolder:
      folder && typeof folder.folderId === "string" && typeof folder.verifiedAt === "string"
        ? { folderId: folder.folderId, title: text(folder.title), verifiedAt: folder.verifiedAt }
        : null,
    oauthAvailable: bool(row.oauthAvailable),
    sheetsSetupAvailable: bool(row.sheetsSetupAvailable),
  };
}

function parseDestination(data: unknown): CompanySheetsDestinationSnapshot | null {
  const root = asRecord(data);
  const row = asRecord(root?.destination);
  if (!row) return null;
  if (typeof row.spreadsheetId !== "string" || typeof row.worksheetId !== "number" || typeof row.worksheetTitle !== "string") {
    return null;
  }
  return {
    spreadsheetId: row.spreadsheetId,
    spreadsheetTitle: text(row.spreadsheetTitle),
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    controlBasis: typeof row.controlBasis === "string" ? row.controlBasis : "",
    accessStatus: typeof row.accessStatus === "string" ? row.accessStatus : "",
    destinationRevision: typeof row.destinationRevision === "number" ? row.destinationRevision : null,
  };
}

function parseContracts(data: unknown): CompanySheetsContractSnapshot[] {
  const root = asRecord(data);
  if (!Array.isArray(root?.contracts)) return [];
  return root.contracts.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.role !== "string" || typeof row.setupState !== "string") return [];
    return [
      {
        role: row.role,
        setupState: row.setupState,
        setupReason: text(row.setupReason),
        worksheetId: typeof row.worksheetId === "number" ? row.worksheetId : null,
        worksheetTitle: text(row.worksheetTitle),
        schemaVersion: text(row.schemaVersion),
      },
    ];
  });
}

function parseDispatch(data: unknown): CompanySheetsDispatchSnapshot | null {
  const row = asRecord(data);
  if (!row || typeof row.campaignDispatchEnabled !== "boolean" || typeof row.agedDispatchEnabled !== "boolean") return null;
  return {
    campaignDispatchEnabled: row.campaignDispatchEnabled,
    agedDispatchEnabled: row.agedDispatchEnabled,
    dispatchFlagEnabled: row.dispatchFlagEnabled === true,
  };
}

function parseMapping(data: unknown): CompanySheetsMappingSnapshot | null {
  const row = asRecord(data);
  if (!row || row.ok !== true || typeof row.readiness !== "string") return null;
  return {
    readiness: row.readiness,
    schemaVersion: text(row.schemaVersion),
    boundSchemaVersion: text(row.boundSchemaVersion),
  };
}

async function loadSaved(clientAccountId: string): Promise<
  | { ok: true; snapshot: CompanySheetsDiscoverySnapshot }
  | { ok: false; result: CompanySheetsDiscoveryActionResult }
> {
  const [connectionRes, destinationRes, tabsRes, dispatchRes] = await Promise.all([
    fetchCompanyGoogleConnection(),
    fetchCompanySheetsDestination(clientAccountId),
    fetchCompanySheetsTabContracts(clientAccountId),
    fetchCompanySheetsDispatch(clientAccountId),
  ]);
  if (!connectionRes.ok) return { ok: false, result: readFailure(clientAccountId, connectionRes) };
  if (!destinationRes.ok) return { ok: false, result: readFailure(clientAccountId, destinationRes) };
  if (!tabsRes.ok) return { ok: false, result: readFailure(clientAccountId, tabsRes) };
  if (!dispatchRes.ok) return { ok: false, result: readFailure(clientAccountId, dispatchRes) };
  const connection = parseConnection(connectionRes.data);
  const destination = destinationRes.data.destination ? parseDestination(destinationRes.data) : null;
  const dispatch = parseDispatch(dispatchRes.data);
  if (!connection || (destinationRes.data.destination && !destination) || !dispatch) {
    const message = "Company Sheets could not be read. Nothing was written.";
    return {
      ok: false,
      result: {
        ok: false,
        code: "provider_error",
        message,
        uncertain: true,
        snapshot: { ...baseSnapshot(clientAccountId, null), loadError: message, uncertain: true },
        nextPageToken: null,
      },
    };
  }
  let mapping: CompanySheetsMappingSnapshot | null = null;
  let mappingError: string | null = null;
  if (connection.sheetsSetupAvailable) {
    const mappingRes = await reviewCompanySheetsColumns(clientAccountId, {});
    if (!mappingRes.ok) mappingError = failureOf(mappingRes).code;
    else {
      mapping = parseMapping(mappingRes.data);
      if (!mapping) mappingError = "provider_error";
    }
  }
  return {
    ok: true,
    snapshot: {
      ...baseSnapshot(clientAccountId, null),
      connection,
      destination,
      contracts: parseContracts(tabsRes.data),
      dispatch,
      mapping,
      mappingError,
    },
  };
}

export async function loadTeamWorkspaceCompanySheetsAction(
  clientAccountId: string
): Promise<CompanySheetsDiscoveryActionResult> {
  const denied = await authorize(clientAccountId);
  if (denied) return denied;
  const id = clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(id)) {
    const message = "This client id cannot be read.";
    return { ok: false, code: "INVALID_CLIENT", message, uncertain: false, snapshot: { ...baseSnapshot(id, null), loadError: message }, nextPageToken: null };
  }
  const loaded = await loadSaved(id);
  if (!loaded.ok) return loaded.result;
  return { ok: true, code: "READ", message: null, uncertain: false, snapshot: loaded.snapshot, nextPageToken: null };
}

export async function inspectTeamWorkspaceCompanySheetsStorageAction(
  clientAccountId: string
): Promise<CompanySheetsDiscoveryActionResult> {
  const denied = await authorize(clientAccountId);
  if (denied) return denied;
  const id = clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(id)) {
    const message = "This client id cannot be read.";
    return { ok: false, code: "INVALID_CLIENT", message, uncertain: false, snapshot: null, nextPageToken: null };
  }
  const loaded = await loadSaved(id);
  if (!loaded.ok) return loaded.result;
  if (!loaded.snapshot.connection?.sheetsSetupAvailable) {
    return {
      ok: false,
      code: "destination_disabled",
      message: companySheetsDiscoveryError("destination_disabled"),
      uncertain: false,
      snapshot: loaded.snapshot,
      nextPageToken: null,
    };
  }
  const inspected = await prepareCompanyClientFolder(id, { intent: "inspect" });
  const listed = await listCompanyClientSpreadsheets(id);
  const stored = await storageFrom(id, inspected, listed);
  const failed = stored.storage.inspectError ?? stored.storage.listError ?? (stored.storage.folderCheck && !stored.storage.folderCheck.ok ? stored.storage.folderCheck.code : null);
  const uncertain = failed === "retryable";
  return {
    ok: !failed,
    code: failed ?? "READ",
    message: failed ? companySheetsDiscoveryError(failed) : null,
    uncertain,
    snapshot: { ...loaded.snapshot, storage: stored.storage, uncertain },
    nextPageToken: stored.nextPageToken,
  };
}

export async function readTeamWorkspaceCompanySheetsWorksheetsAction(
  clientAccountId: string,
  spreadsheet: string
): Promise<CompanySheetsWorksheetActionResult> {
  const denied = await authorize(clientAccountId);
  if (denied) return { ok: false, code: denied.code, message: denied.message, uncertain: false, read: null };
  const id = clientAccountId.trim();
  const target = spreadsheet.trim();
  if (!isSafeTeamWorkspaceId(id) || !target || target.length > 300) {
    return { ok: false, code: "invalid_spreadsheet_ref", message: companySheetsDiscoveryError("invalid_spreadsheet_ref"), uncertain: false, read: null };
  }
  const connection = await fetchCompanyGoogleConnection();
  if (!connection.ok) {
    const failure = failureOf(connection);
    return { ok: false, code: failure.code, message: companySheetsDiscoveryError(failure.code), uncertain: failure.uncertain, read: null };
  }
  const parsed = parseConnection(connection.data);
  if (!parsed?.sheetsSetupAvailable) {
    return { ok: false, code: "destination_disabled", message: companySheetsDiscoveryError("destination_disabled"), uncertain: false, read: null };
  }
  const resolved = await resolveCompanySpreadsheet(id, target);
  if (!resolved.ok) {
    const failure = failureOf(resolved);
    return {
      ok: false,
      code: failure.code,
      message: companySheetsDiscoveryError(failure.code),
      uncertain: failure.uncertain,
      read: {
        spreadsheetId: target,
        ok: false,
        code: failure.code,
        title: null,
        controlBasis: null,
        worksheets: [],
      },
    };
  }
  const sheet = asRecord(asRecord(resolved.data)?.spreadsheet);
  const worksheets = Array.isArray(sheet?.worksheets) ? sheet.worksheets : null;
  if (!sheet || typeof sheet.spreadsheetId !== "string" || !worksheets) {
    return { ok: false, code: "provider_error", message: companySheetsDiscoveryError("provider_error"), uncertain: true, read: null };
  }
  return {
    ok: true,
    code: "READ",
    message: null,
    uncertain: false,
    read: {
      spreadsheetId: sheet.spreadsheetId,
      ok: true,
      code: null,
      title: text(sheet.title),
      controlBasis: text(sheet.controlBasis),
      worksheets: worksheets.flatMap((item) => {
        const row = asRecord(item);
        if (!row || typeof row.sheetId !== "number") return [];
        return [{ worksheetId: row.sheetId, title: text(row.title) ?? `Worksheet ${row.sheetId}`, sheetType: text(row.sheetType) }];
      }),
    },
  };
}

export async function pageTeamWorkspaceCompanySheetsSpreadsheetsAction(
  clientAccountId: string,
  pageToken: string
): Promise<CompanySheetsPageActionResult> {
  const denied = await authorize(clientAccountId);
  if (denied) return { ok: false, code: denied.code, message: denied.message, uncertain: false, spreadsheets: [], skipped: 0, nextPageToken: null };
  const id = clientAccountId.trim();
  const token = pageToken.trim();
  if (!isSafeTeamWorkspaceId(id) || !token || token.length > 512) {
    return { ok: false, code: "invalid_folder", message: companySheetsDiscoveryError("invalid_folder"), uncertain: false, spreadsheets: [], skipped: 0, nextPageToken: null };
  }
  const listed = await listCompanyClientSpreadsheets(id, token);
  if (!listed.ok) {
    const failure = failureOf(listed);
    return { ok: false, code: failure.code, message: companySheetsDiscoveryError(failure.code), uncertain: failure.uncertain, spreadsheets: [], skipped: 0, nextPageToken: null };
  }
  return {
    ok: true,
    code: "READ",
    message: null,
    uncertain: false,
    spreadsheets: parseSpreadsheetList(listed.data),
    skipped: typeof listed.data.skipped === "number" ? listed.data.skipped : 0,
    nextPageToken: text(listed.data.nextPageToken),
  };
}

async function storageFrom(
  clientAccountId: string,
  inspected: AdminResult<{ ok: true; created?: boolean; linked?: boolean; driveDeleted?: boolean; outcome?: string; folders?: Array<{ folderId: string; title: string }> }>,
  listed: AdminResult<{ folder: { folderId: string; title: string } | null; spreadsheets: Array<{ spreadsheetId: string; title: string }>; nextPageToken: string | null; skipped: number; folderEvents?: Array<{ action: string }> }>
): Promise<{ storage: CompanySheetsStorageSnapshot; nextPageToken: string | null }> {
  const inspectError = inspected.ok ? null : failureOf(inspected).code;
  const listError = listed.ok ? null : failureOf(listed).code;
  const changed = inspected.ok && (
    inspected.data.created === true ||
    inspected.data.linked === true ||
    inspected.data.driveDeleted === true ||
    (inspected.data.outcome != null && inspected.data.outcome !== "select")
  );
  const folder = listed.ok && listed.data.folder?.folderId ? { folderId: listed.data.folder.folderId, title: listed.data.folder.title } : null;
  const events = listed.ok && Array.isArray(listed.data.folderEvents) ? listed.data.folderEvents : [];
  const unlinked = events[0]?.action === "unlinked";
  let folderCheck: CompanySheetsStorageSnapshot["folderCheck"] = null;
  if (changed) folderCheck = { ok: false, code: "storage_changed" };
  else if (folder && !unlinked && !listError) {
    const checked = await resolveCompanyClientFolder(clientAccountId, folder.folderId);
    if (!checked.ok) folderCheck = { ok: false, code: failureOf(checked).code };
    else {
      const basis = text(asRecord(asRecord(checked.data)?.folder)?.basis);
      folderCheck = basis === "approved_shared_drive"
        ? { ok: true, basis }
        : { ok: false, code: "outside_approved_parent" };
    }
  }
  const candidates = inspected.ok && Array.isArray(inspected.data.folders)
    ? inspected.data.folders.flatMap((item) => {
        const row = asRecord(item);
        if (!row || typeof row.folderId !== "string") return [];
        if (folder && row.folderId === folder.folderId) return [];
        return [{ folderId: row.folderId, title: text(row.title) ?? row.folderId }];
      })
    : [];
  return {
    storage: {
      inspectError: changed ? "storage_changed" : inspectError,
      listError,
      folder: unlinked ? null : folder,
      folderUnlinked: Boolean(unlinked),
      folderCheck: unlinked ? null : folderCheck,
      spreadsheets: listed.ok && !unlinked && folderCheck?.ok ? parseSpreadsheetList(listed.data) : [],
      skipped: listed.ok ? listed.data.skipped : 0,
      candidates,
    },
    nextPageToken: listed.ok ? text(listed.data.nextPageToken) : null,
  };
}

function parseSpreadsheetList(data: { spreadsheets?: Array<{ spreadsheetId?: string; title?: string }> }): Array<{ spreadsheetId: string; title: string }> {
  return (data.spreadsheets ?? []).flatMap((item) => {
    if (!item.spreadsheetId) return [];
    return [{ spreadsheetId: item.spreadsheetId, title: item.title || item.spreadsheetId }];
  });
}
