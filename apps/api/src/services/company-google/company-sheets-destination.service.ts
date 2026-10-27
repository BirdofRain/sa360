import type { CompanyGoogleConnection, CompanySheetsDestination, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_GOOGLE_DRIVE_FILE_SCOPE,
  COMPANY_GOOGLE_DRIVE_METADATA_SCOPE,
  COMPANY_GOOGLE_SPREADSHEETS_SCOPE,
  COMPANY_SHEETS_DELIVERY_EXECUTION_DISABLED,
  COMPANY_SHEETS_WRITE_READINESS_NOT_VERIFIED,
  deriveCompanySheetsControl,
  grantedScopeList,
  isCompanyGoogleSheetsEnabled,
  parseCompanyDriveFolderRef,
  parseIntendedRecipientEmail,
  projectCompanySheetsSharing,
  readCompanyStorageConfig,
  type CompanySheetsControlBasis,
  type CompanySheetsSharingProjection,
  type CompanyStorageConfig,
} from "../../lib/company-google-sheets-env.js";
import {
  buildSafeSpreadsheetUrl,
  isSafeGoogleSpreadsheetUrl,
  parseGoogleWorksheetId,
} from "../../lib/google-sheets-env.js";
import {
  presentCompanySheetsTabs,
  type CompanySheetsJobState,
  type CompanySheetsStoredTab,
  type CompanySheetsTabView,
} from "../../lib/company-sheets-tab-view.js";
import { parseGoogleSpreadsheetRef } from "../../lib/google-spreadsheet-ref.js";
import { findCompanyGoogleConnection } from "../../repositories/company-google-connection.repository.js";
import {
  deleteCompanySheetsDestination,
  findClientForCompanySheets,
  findCompanySheetsDestinationByClient,
  findCompanySpreadsheetCreation,
  insertCompanySpreadsheetCreation,
  saveCompanySheetsDestination,
  updateCompanySheetsAccess,
} from "../../repositories/company-sheets-destination.repository.js";
import {
  getValidCompanyGoogleAccessToken,
  type CompanyGoogleAccessTokenDeps,
  type CompanyGoogleAccessTokenResult,
} from "./company-google-access-token.service.js";
import {
  clearCompanyDestinationFolder,
  getCompanyGoogleConnection,
  setCompanyDestinationFolder,
  type CompanyGoogleConnectionView,
} from "./company-google-connection.service.js";
import {
  createCompanyDriveFile,
  findCompanyDriveChildFolder,
  findCompanyDriveNamedChild,
  getCompanyDriveFile,
  type CompanyDriveFile,
  type CompanyDriveHttpFailure,
} from "./company-google-drive-http.js";
import {
  collectSharedDriveAncestors,
  COMPANY_DRIVE_FOLDER_MIME,
  COMPANY_DRIVE_SPREADSHEET_MIME,
  evaluateCompanyStorageFile,
  locateCompanyStorageFile,
  type CompanyStorageBasis,
  type CompanyStorageOperation,
} from "./company-google-storage-policy.js";
import {
  getSpreadsheetMetadata,
  type GoogleSheetsHttpFailure,
  type GoogleSpreadsheetMetadata,
} from "../google-sheets/google-sheets-http-client.js";

export type CompanySheetsError =
  | "destination_disabled"
  | "client_not_found"
  | "google_not_connected"
  | "google_reconnect_required"
  | "oauth_not_configured"
  | "invalid_spreadsheet_ref"
  | "invalid_title"
  | "invalid_worksheet"
  | "invalid_recipient"
  | "invalid_folder"
  | "access_denied"
  | "spreadsheet_unavailable"
  | "worksheet_unavailable"
  | "worksheet_not_grid"
  | "not_company_controlled"
  | "shared_drive_unsupported"
  | "approved_drive_unconfigured"
  | "approved_parent_unconfigured"
  | "unapproved_shared_drive"
  | "outside_approved_parent"
  | "insufficient_capability"
  | "ancestry_unavailable"
  | "ancestry_cycle"
  | "ancestry_limit"
  | "trashed_file"
  | "shortcut_bypass"
  | "not_approved_parent"
  | "folder_unavailable"
  | "ambiguous_client_folder"
  | "ambiguous_spreadsheet"
  | "child_lookup_unsupported"
  | "create_placement_failed"
  | "ownership_unverified"
  | "drive_scope_required"
  | "drive_file_scope_required"
  | "spreadsheets_scope_required"
  | "destination_folder_unverified"
  | "folder_not_company_owned"
  | "spreadsheet_bound_to_other_client"
  | "destination_conflict"
  | "create_outcome_unknown"
  | "create_in_progress"
  | "recorded_folder_unavailable"
  | "folder_not_in_parent"
  | "pause_delivery_first"
  | "unresolved_delivery"
  | "cutoff_retained"
  | "invalid_folder_intent"
  | "unsupported_schema"
  | "retryable"
  | "provider_error";

export type CompanySheetsFailure = {
  ok: false;
  code: CompanySheetsError;
  statusCode: number;
  retryable: boolean;
};

export type CompanySheetsDestinationView = {
  configured: true;
  clientAccountId: string;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string;
  worksheetId: number;
  worksheetTitle: string;
  controlBasis: string;
  accessStatus: string;
  accessCheckedAt: string | null;
  writeReadiness: "not_verified";
  deliveryExecution: "disabled";
  liveDeliveryEnabled: false;
  enabled: false;
  sharing: CompanySheetsSharingProjection;
  connection: {
    status: CompanyGoogleConnectionView["status"];
    connected: boolean;
    reconnectRequired: boolean;
  };
  destinationRevision: number;
  tabContracts: CompanySheetsTabView[];
};

export type CompanySheetsDeps = {
  env?: NodeJS.ProcessEnv;
  db?: PrismaClient;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  getAccessToken?: typeof getValidCompanyGoogleAccessToken;
  getMetadata?: typeof getSpreadsheetMetadata;
  getDriveFile?: typeof getCompanyDriveFile;
  createDriveFile?: typeof createCompanyDriveFile;
  findChildFolder?: typeof findCompanyDriveChildFolder;
  findNamedChild?: typeof findCompanyDriveNamedChild;
};

const TITLE_MAX = 120;

export function companySheetsErrorStatus(code: CompanySheetsError): number {
  switch (code) {
    case "destination_disabled":
    case "client_not_found":
    case "spreadsheet_unavailable":
    case "worksheet_unavailable":
    case "folder_unavailable":
      return 404;
    case "invalid_spreadsheet_ref":
    case "invalid_title":
    case "invalid_worksheet":
    case "invalid_recipient":
    case "invalid_folder":
    case "worksheet_not_grid":
      return 400;
    case "google_not_connected":
    case "google_reconnect_required":
    case "not_company_controlled":
    case "shared_drive_unsupported":
    case "approved_drive_unconfigured":
    case "approved_parent_unconfigured":
    case "unapproved_shared_drive":
    case "outside_approved_parent":
    case "insufficient_capability":
    case "ancestry_unavailable":
    case "ancestry_cycle":
    case "ancestry_limit":
    case "trashed_file":
    case "shortcut_bypass":
    case "not_approved_parent":
    case "ambiguous_client_folder":
    case "ambiguous_spreadsheet":
    case "child_lookup_unsupported":
    case "create_placement_failed":
    case "ownership_unverified":
    case "destination_folder_unverified":
    case "folder_not_company_owned":
    case "spreadsheet_bound_to_other_client":
    case "destination_conflict":
    case "create_outcome_unknown":
    case "create_in_progress":
    case "recorded_folder_unavailable":
    case "folder_not_in_parent":
    case "pause_delivery_first":
    case "unresolved_delivery":
    case "cutoff_retained":
      return 409;
    case "invalid_folder_intent":
    case "unsupported_schema":
      return 400;
    case "access_denied":
    case "drive_scope_required":
    case "drive_file_scope_required":
    case "spreadsheets_scope_required":
      return 403;
    case "oauth_not_configured":
    case "retryable":
      return 503;
    default:
      return 502;
  }
}

function fail(code: CompanySheetsError, retryable = code === "retryable"): CompanySheetsFailure {
  return { ok: false, code, statusCode: companySheetsErrorStatus(code), retryable };
}

function requireEnabled(env: NodeJS.ProcessEnv): CompanySheetsFailure | null {
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled");
  return null;
}

async function loadCompanySheetsTabState(
  db: PrismaClient,
  row: CompanySheetsDestination
): Promise<{ contracts: CompanySheetsStoredTab[]; jobs: CompanySheetsJobState[] }> {
  const [contracts, openJobs, succeededJobs] = await Promise.all([
    db.companySheetsTabContract.findMany({ where: { destinationId: row.id } }),
    db.companySheetsDeliveryJob.findMany({
      where: { clientAccountId: row.clientAccountId, status: { not: "succeeded" } },
      select: { kind: true, status: true, rowsWritten: true, rowsTotal: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    db.companySheetsDeliveryJob.findMany({
      where: { clientAccountId: row.clientAccountId, status: "succeeded" },
      distinct: ["kind"],
      select: { kind: true, status: true, rowsWritten: true, rowsTotal: true },
    }),
  ]);
  return {
    contracts: contracts.map((contract) => ({
      role: contract.role,
      setupState: contract.setupState,
      setupReason: contract.setupReason,
      worksheetId: contract.worksheetId,
      worksheetTitle: contract.worksheetTitle,
      schemaVersion: contract.schemaVersion,
    })),
    jobs: [...openJobs, ...succeededJobs],
  };
}

export function presentCompanySheetsDestination(
  row: CompanySheetsDestination,
  connection: CompanyGoogleConnection | null,
  tabState: { contracts: CompanySheetsStoredTab[]; jobs: CompanySheetsJobState[] } = { contracts: [], jobs: [] }
): CompanySheetsDestinationView {
  const connectionView = connection
    ? {
        status: connection.status,
        connected: connection.status === "connected",
        reconnectRequired: connection.status === "reconnect_required" || connection.status === "error",
      }
    : { status: "disconnected" as const, connected: false, reconnectRequired: false };
  const url = isSafeGoogleSpreadsheetUrl(row.spreadsheetUrl, row.spreadsheetId)
    ? row.spreadsheetUrl
    : buildSafeSpreadsheetUrl(row.spreadsheetId);
  return {
    configured: true,
    clientAccountId: row.clientAccountId,
    spreadsheetId: row.spreadsheetId,
    spreadsheetTitle: row.spreadsheetTitle,
    spreadsheetUrl: url,
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    controlBasis: row.controlBasis,
    accessStatus: row.accessStatus,
    accessCheckedAt: row.accessCheckedAt?.toISOString() ?? null,
    writeReadiness: COMPANY_SHEETS_WRITE_READINESS_NOT_VERIFIED,
    deliveryExecution: COMPANY_SHEETS_DELIVERY_EXECUTION_DISABLED,
    liveDeliveryEnabled: false,
    enabled: false,
    sharing: projectCompanySheetsSharing(row.intendedRecipientEmail),
    connection: connectionView,
    destinationRevision: row.destinationRevision,
    tabContracts: presentCompanySheetsTabs({
      spreadsheetId: row.spreadsheetId,
      spreadsheetUrl: url,
      contracts: tabState.contracts,
      jobs: tabState.jobs,
    }),
  };
}

export function presentCompanySheetsPortal(view: CompanySheetsDestinationView) {
  return {
    configured: true as const,
    clientAccountId: view.clientAccountId,
    spreadsheetTitle: view.spreadsheetTitle,
    spreadsheetUrl: view.spreadsheetUrl,
    worksheetTitle: view.worksheetTitle,
    accessStatus: view.accessStatus,
    writeReadiness: view.writeReadiness,
    deliveryExecution: view.deliveryExecution,
    liveDeliveryEnabled: false as const,
    sharing: {
      portalLinkGrantsGoogleAccess: false as const,
      clientGooglePermission: "not_granted" as const,
      anyoneWithLink: false as const,
      public: false as const,
      missingRecipientPolicy: view.sharing.missingRecipientPolicy,
      status: view.sharing.status,
    },
    connection: view.connection,
    destinationRevision: view.destinationRevision,
    tabs: view.tabContracts.filter((tab) => tab.role === "campaign" || tab.role === "aged"),
    orderDelivery: {
      status: "not_started" as const,
      automatedWritesEnabled: false as const,
    },
  };
}

function mapToken(code: Exclude<CompanyGoogleAccessTokenResult, { ok: true }>["code"]): CompanySheetsFailure {
  if (code === "refresh_retryable") return fail("retryable", true);
  if (code === "provider_error") return fail("provider_error");
  return fail(code);
}

function mapSheets(reason: GoogleSheetsHttpFailure, kind: "spreadsheet" | "worksheet" = "spreadsheet") {
  switch (reason) {
    case "unauthorized":
      return fail("google_reconnect_required");
    case "access_denied":
      return fail("access_denied");
    case "not_found":
      return fail(kind === "worksheet" ? "worksheet_unavailable" : "spreadsheet_unavailable");
    case "invalid_request":
      return fail("invalid_spreadsheet_ref");
    case "rate_limited":
    case "server_error":
    case "network_error":
      return fail("retryable", true);
    default:
      return fail("provider_error");
  }
}

function mapStorageReason(
  reason: string,
  kind: "spreadsheet" | "folder" = "spreadsheet"
): CompanySheetsFailure {
  switch (reason) {
    case "unauthorized":
      return fail("google_reconnect_required");
    case "access_denied":
      return fail("access_denied");
    case "not_found":
      return fail(kind === "folder" ? "folder_unavailable" : "spreadsheet_unavailable");
    case "rate_limited":
    case "server_error":
    case "network_error":
      return fail("retryable", true);
    case "not_company_controlled":
    case "approved_drive_unconfigured":
    case "approved_parent_unconfigured":
    case "unapproved_shared_drive":
    case "outside_approved_parent":
    case "insufficient_capability":
    case "ancestry_unavailable":
    case "ancestry_cycle":
    case "ancestry_limit":
    case "trashed_file":
    case "shortcut_bypass":
    case "ambiguous_client_folder":
    case "ambiguous_spreadsheet":
      return fail(reason);
    default:
      return fail(kind === "folder" ? "invalid_folder" : "ownership_unverified");
  }
}

function sanitizeTitle(raw: unknown, fallback: string): { ok: true; title: string } | { ok: false } {
  const source = typeof raw === "string" && raw.trim() ? raw : fallback;
  const title = source.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || title.length > TITLE_MAX) return { ok: false };
  return { ok: true, title };
}

function hasScope(connection: CompanyGoogleConnection, scope: string): boolean {
  return grantedScopeList(connection.scopes).includes(scope);
}

export async function loadReadyConnection(
  deps: CompanySheetsDeps
): Promise<
  | { ok: true; connection: CompanyGoogleConnection; accessToken: string }
  | CompanySheetsFailure
> {
  const db = deps.db ?? prisma;
  const token = await (deps.getAccessToken ?? getValidCompanyGoogleAccessToken)({
    env: deps.env,
    db,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!token.ok) return mapToken(token.code);
  const connection = await findCompanyGoogleConnection(db);
  if (!connection || connection.status !== "connected") return fail("google_not_connected");
  if (!hasScope(connection, COMPANY_GOOGLE_SPREADSHEETS_SCOPE)) {
    return fail("spreadsheets_scope_required");
  }
  return { ok: true, connection, accessToken: token.accessToken };
}

function pickWorksheet(metadata: GoogleSpreadsheetMetadata, worksheetId: number) {
  return metadata.worksheets.find((sheet) => sheet.sheetId === worksheetId) ?? null;
}

export async function establishControl(
  input: {
    connection: CompanyGoogleConnection;
    accessToken: string;
    spreadsheetId: string;
    metadata: GoogleSpreadsheetMetadata;
  },
  deps: CompanySheetsDeps
): Promise<
  | {
      ok: true;
      controlBasis: CompanySheetsControlBasis;
      creationId: string | null;
    }
  | CompanySheetsFailure
> {
  const db = deps.db ?? prisma;
  const env = deps.env ?? process.env;
  const creation = await findCompanySpreadsheetCreation(input.spreadsheetId, db);
  const creationMarker = Boolean(creation && creation.companyConnectionId === input.connection.id);
  if (!hasScope(input.connection, COMPANY_GOOGLE_DRIVE_METADATA_SCOPE)) {
    return fail("drive_scope_required");
  }
  const drive = await (deps.getDriveFile ?? getCompanyDriveFile)(
    { fileId: input.spreadsheetId, accessToken: input.accessToken },
    deps.fetchImpl
  );
  if (!drive.ok) return mapStorageReason(drive.reason, "spreadsheet");
  if (drive.file.id !== input.spreadsheetId) return fail("ownership_unverified");
  if (drive.file.mimeType !== COMPANY_DRIVE_SPREADSHEET_MIME) return fail("invalid_spreadsheet_ref");
  const stored = await evaluateStoredFile(
    drive.file,
    "edit",
    input.connection.googleEmail,
    input.accessToken,
    deps,
    env,
    "spreadsheet"
  );
  if (!stored.ok) return stored;
  if (stored.basis === "approved_shared_drive") {
    return {
      ok: true,
      controlBasis: creationMarker ? "company_created" : "approved_shared_drive",
      creationId: creation?.id ?? null,
    };
  }
  const control = deriveCompanySheetsControl({ creationMarker, driveOwnerMatch: true });
  if (!control.ok) return fail(control.reason);
  return { ok: true, controlBasis: control.controlBasis, creationId: creation?.id ?? null };
}

export async function getCompanySheetsDestinationForClient(
  clientAccountId: string,
  deps: CompanySheetsDeps = {}
): Promise<{ ok: true; destination: CompanySheetsDestinationView | null }> {
  const db = deps.db ?? prisma;
  const row = await findCompanySheetsDestinationByClient(clientAccountId, db);
  if (!row) return { ok: true, destination: null };
  const connection = await findCompanyGoogleConnection(db);
  const tabState = await loadCompanySheetsTabState(db, row);
  return { ok: true, destination: presentCompanySheetsDestination(row, connection, tabState) };
}

export async function resolveCompanySpreadsheetForClient(
  clientAccountId: string,
  spreadsheet: unknown,
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      spreadsheet: {
        spreadsheetId: string;
        title: string;
        spreadsheetUrl: string;
        worksheets: GoogleSpreadsheetMetadata["worksheets"];
        controlBasis: CompanySheetsControlBasis;
        writable: false;
      };
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const parsed = parseGoogleSpreadsheetRef(spreadsheet);
  if (!parsed.ok) return fail("invalid_spreadsheet_ref");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: parsed.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return mapSheets(metadataResult.reason);
  const control = await establishControl(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: parsed.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db }
  );
  if (!control.ok) return control;
  return {
    ok: true,
    spreadsheet: {
      spreadsheetId: metadataResult.metadata.spreadsheetId,
      title: metadataResult.metadata.title,
      spreadsheetUrl: metadataResult.metadata.spreadsheetUrl,
      worksheets: metadataResult.metadata.worksheets,
      controlBasis: control.controlBasis,
      writable: false,
    },
  };
}

export async function createCompanySpreadsheetForClient(
  clientAccountId: string,
  title: unknown,
  actor: string | null,
  deps: CompanySheetsDeps = {},
  folderRef?: unknown
): Promise<
  | {
      ok: true;
      spreadsheet: {
        spreadsheetId: string;
        title: string;
        spreadsheetUrl: string;
        worksheet: { sheetId: number; title: string };
        controlBasis: CompanySheetsControlBasis;
        folderPlacement: string;
        destinationSaved: false;
        created: boolean;
        writable: false;
      };
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const sanitized = sanitizeTitle(title, `${client.clientDisplayName} Leads`);
  if (!sanitized.ok) return fail("invalid_title");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  if (ready.connection.destinationFolderId && !ready.connection.destinationFolderVerifiedAt) {
    return fail("destination_folder_unverified");
  }
  if (!hasScope(ready.connection, COMPANY_GOOGLE_DRIVE_FILE_SCOPE)) return fail("drive_file_scope_required");
  if (!hasScope(ready.connection, COMPANY_GOOGLE_SPREADSHEETS_SCOPE)) return fail("spreadsheets_scope_required");
  const parent = await resolveCreateFolder(client.clientAccountId, folderRef, ready, deps, env);
  if (!parent.ok) return parent;
  const placed = await placeNamedFile(
    {
      parentId: parent.folderId,
      driveId: parent.driveId,
      name: sanitized.title,
      mimeType: COMPANY_DRIVE_SPREADSHEET_MIME,
      operation: "edit",
      kind: "spreadsheet",
      lockKey: `company-sheets-spreadsheet:${parent.folderId}:${sanitized.title}`,
    },
    ready,
    deps,
    env,
    db
  );
  if (!placed.ok) return placed;
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: placed.file.id, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok || metadataResult.metadata.spreadsheetId !== placed.file.id) {
    return placed.created ? fail("create_outcome_unknown") : mapSheets(metadataResult.ok ? "malformed_response" : metadataResult.reason);
  }
  const worksheet = metadataResult.metadata.worksheets[0];
  if (!worksheet) return placed.created ? fail("create_outcome_unknown") : fail("worksheet_unavailable");
  if (placed.created) {
    try {
      await insertCompanySpreadsheetCreation(
        {
          companyConnectionId: ready.connection.id,
          spreadsheetId: metadataResult.metadata.spreadsheetId,
          spreadsheetTitle: metadataResult.metadata.title,
          spreadsheetUrl: metadataResult.metadata.spreadsheetUrl,
          worksheetId: worksheet.sheetId,
          worksheetTitle: worksheet.title,
          folderId: parent.folderId,
          folderPlacement: "placed",
          createdByActor: actor,
        },
        db
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") return fail("provider_error");
    }
  }

  return {
    ok: true,
    spreadsheet: {
      spreadsheetId: metadataResult.metadata.spreadsheetId,
      title: metadataResult.metadata.title,
      spreadsheetUrl: metadataResult.metadata.spreadsheetUrl,
      worksheet: { sheetId: worksheet.sheetId, title: worksheet.title },
      controlBasis: placed.created ? "company_created" : controlBasisForAdopted(placed.basis),
      folderPlacement: "placed",
      destinationSaved: false,
      created: placed.created,
      writable: false,
    },
  };
}

export async function resolveCompanyClientFolder(
  clientAccountId: string,
  folder: unknown,
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      folder: { folderId: string; title: string; driveId: string | null; basis: CompanyStorageBasis };
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const parsed = parseCompanyDriveFolderRef(folder);
  if (!parsed.ok) return fail("invalid_folder");
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const verified = await verifyFolderForAddChild(parsed.folderId, ready, deps, env);
  if (!verified.ok) return verified;
  return {
    ok: true,
    folder: {
      folderId: verified.file.id,
      title: verified.file.name,
      driveId: verified.file.driveId,
      basis: verified.basis,
    },
  };
}

export async function ensureCompanyClientFolder(
  clientAccountId: string,
  deps: CompanySheetsDeps = {}
): Promise<
  | { ok: true; folder: { folderId: string; title: string; created: boolean } }
  | CompanySheetsFailure
> {
  const { prepareCompanyClientFolder } = await import("./company-sheets-setup.service.js");
  const prepared = await prepareCompanyClientFolder(clientAccountId, { intent: "create" }, deps);
  if (!prepared.ok) return prepared;
  if (
    prepared.folder &&
    (prepared.outcome === "created" || prepared.outcome === "reused" || prepared.outcome === "linked")
  ) {
    return {
      ok: true,
      folder: { folderId: prepared.folder.folderId, title: prepared.folder.title, created: prepared.created },
    };
  }
  if (prepared.outcome === "select" && prepared.folders.length === 1) {
    const only = prepared.folders[0];
    if (!only) return fail("create_outcome_unknown");
    const linked = await prepareCompanyClientFolder(
      clientAccountId,
      { intent: "link", folderId: only.folderId },
      deps
    );
    if (!linked.ok) return linked;
    if (!linked.folder || linked.outcome !== "linked") return fail("create_outcome_unknown");
    return {
      ok: true,
      folder: { folderId: linked.folder.folderId, title: linked.folder.title, created: prepared.created },
    };
  }
  if (prepared.outcome === "select") return fail("ambiguous_client_folder");
  if (prepared.outcome === "in_progress") return fail("create_in_progress");
  return fail("create_outcome_unknown");
}

export async function testCompanySheetAccessForClient(
  clientAccountId: string,
  input: { spreadsheetId: unknown; worksheetId: unknown },
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      result: {
        ok: true;
        spreadsheetTitle: string;
        worksheetTitle: string;
        readOnlyAccess: true;
        writePermissionVerified: false;
        liveDeliveryEnabled: false;
      };
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const parsed = parseGoogleSpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return fail("invalid_spreadsheet_ref");
  const worksheetId = parseGoogleWorksheetId(input.worksheetId);
  if (worksheetId == null) return fail("invalid_worksheet");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: parsed.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return mapSheets(metadataResult.reason);
  const worksheet = pickWorksheet(metadataResult.metadata, worksheetId);
  if (!worksheet) return fail("worksheet_unavailable");
  if (worksheet.sheetType !== "GRID") return fail("worksheet_not_grid");
  const control = await establishControl(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: parsed.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db }
  );
  const existing = await findCompanySheetsDestinationByClient(clientAccountId, db);
  if (!control.ok) {
    if (existing && existing.spreadsheetId === parsed.spreadsheetId) {
      await updateCompanySheetsAccess(
        {
          clientAccountId,
          accessStatus: control.code,
          accessCheckedAt: deps.now?.() ?? new Date(),
        },
        db
      );
    }
    return control;
  }
  if (existing && existing.spreadsheetId === parsed.spreadsheetId) {
    await updateCompanySheetsAccess(
      {
        clientAccountId,
        accessStatus: "readable",
        accessCheckedAt: deps.now?.() ?? new Date(),
      },
      db
    );
  }
  return {
    ok: true,
    result: {
      ok: true,
      spreadsheetTitle: metadataResult.metadata.title,
      worksheetTitle: worksheet.title,
      readOnlyAccess: true,
      writePermissionVerified: false,
      liveDeliveryEnabled: false,
    },
  };
}

export async function saveCompanySheetsDestinationForClient(
  clientAccountId: string,
  input: {
    spreadsheetId: unknown;
    worksheetId: unknown;
    intendedRecipientEmail?: unknown;
  },
  actor: string | null,
  deps: CompanySheetsDeps = {}
): Promise<{ ok: true; destination: CompanySheetsDestinationView } | CompanySheetsFailure> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const parsed = parseGoogleSpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return fail("invalid_spreadsheet_ref");
  const worksheetId = parseGoogleWorksheetId(input.worksheetId);
  if (worksheetId == null) return fail("invalid_worksheet");
  const recipient = parseIntendedRecipientEmail(input.intendedRecipientEmail);
  if (!recipient.ok) return fail("invalid_recipient");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: parsed.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return mapSheets(metadataResult.reason);
  const worksheet = pickWorksheet(metadataResult.metadata, worksheetId);
  if (!worksheet) return fail("worksheet_unavailable");
  if (worksheet.sheetType !== "GRID") return fail("worksheet_not_grid");
  const control = await establishControl(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: parsed.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db }
  );
  if (!control.ok) return control;
  const existingDestination = await findCompanySheetsDestinationByClient(clientAccountId, db);
  if (existingDestination && existingDestination.spreadsheetId !== metadataResult.metadata.spreadsheetId) {
    if (existingDestination.campaignDispatchEnabled || existingDestination.agedDispatchEnabled) {
      return fail("pause_delivery_first");
    }
    const retained = await retainedDestinationBlock(client.clientAccountId, existingDestination, db);
    if (retained) return retained;
  }
  const sharing = projectCompanySheetsSharing(recipient.email);
  const saved = await saveCompanySheetsDestination(
    {
      clientAccountId,
      companyConnectionId: ready.connection.id,
      spreadsheetId: metadataResult.metadata.spreadsheetId,
      spreadsheetTitle: metadataResult.metadata.title,
      spreadsheetUrl: metadataResult.metadata.spreadsheetUrl,
      worksheetId: worksheet.sheetId,
      worksheetTitle: worksheet.title,
      controlBasis: control.controlBasis,
      companySpreadsheetCreationId: control.creationId,
      accessStatus: "readable",
      accessCheckedAt: deps.now?.() ?? new Date(),
      sharingStatus: sharing.status,
      intendedRecipientEmail: sharing.intendedRecipientEmail,
      createdByActor: actor,
    },
    db
  );
  if (!saved.ok) return fail(saved.reason);
  if (saved.row.enabled || saved.row.deliveryExecution !== "disabled" || saved.row.writeReadiness !== "not_verified") {
    return fail("provider_error");
  }
  return {
    ok: true,
    destination: presentCompanySheetsDestination(saved.row, ready.connection),
  };
}

export async function deleteCompanySheetsDestinationForClient(
  clientAccountId: string,
  deps: CompanySheetsDeps = {}
): Promise<{ ok: true; destination: null } | CompanySheetsFailure> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const existing = await findCompanySheetsDestinationByClient(client.clientAccountId, db);
  if (!existing) return { ok: true, destination: null };
  if (existing.campaignDispatchEnabled || existing.agedDispatchEnabled) return fail("pause_delivery_first");
  const retained = await retainedDestinationBlock(client.clientAccountId, existing, db);
  if (retained) return retained;
  await deleteCompanySheetsDestination(client.clientAccountId, db);
  return { ok: true, destination: null };
}

async function retainedDestinationBlock(
  clientAccountId: string,
  destination: { campaignDispatchNotBefore: Date | null; agedDispatchNotBefore: Date | null },
  db: PrismaClient
): Promise<CompanySheetsFailure | null> {
  const unresolved = await db.companySheetsDeliveryJob.findFirst({
    where: {
      clientAccountId,
      OR: [
        { status: { in: ["queued", "running", "retryable", "uncertain"] } },
        { appendStartedAt: { not: null }, status: { not: "succeeded" } },
      ],
    },
    select: { id: true },
  });
  if (unresolved) return fail("unresolved_delivery");
  if (destination.campaignDispatchNotBefore || destination.agedDispatchNotBefore) return fail("cutoff_retained");
  return null;
}

async function loadDriveFile(
  fileId: string,
  accessToken: string,
  deps: CompanySheetsDeps
): Promise<{ ok: true; file: CompanyDriveFile } | { ok: false; reason: CompanyDriveHttpFailure }> {
  return (deps.getDriveFile ?? getCompanyDriveFile)({ fileId, accessToken }, deps.fetchImpl);
}

async function evaluateStoredFile(
  file: CompanyDriveFile,
  operation: CompanyStorageOperation,
  companyEmail: string | null,
  accessToken: string,
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv,
  kind: "spreadsheet" | "folder"
): Promise<{ ok: true; basis: CompanyStorageBasis } | CompanySheetsFailure> {
  const config = readCompanyStorageConfig(env);
  let ancestorFolderIds: string[] = [];
  if (file.driveId) {
    const canWalk = Boolean(
      config.approvedSharedDriveId &&
        config.approvedParentFolderId &&
        file.driveId === config.approvedSharedDriveId
    );
    if (!canWalk) {
      const located = locateCompanyStorageFile({ file, ancestorFolderIds, config, companyEmail });
      if (!located.ok) return mapStorageReason(located.reason, kind);
    } else {
      const ancestors = await collectSharedDriveAncestors(
        file,
        config.approvedSharedDriveId ?? "",
        config.approvedParentFolderId ?? "",
        (fileId) => loadDriveFile(fileId, accessToken, deps)
      );
      if (!ancestors.ok) return mapStorageReason(ancestors.reason, kind);
      ancestorFolderIds = ancestors.ancestorFolderIds;
    }
  }
  const decision = evaluateCompanyStorageFile({
    file,
    ancestorFolderIds,
    config,
    companyEmail,
    operation,
  });
  if (!decision.ok) return mapStorageReason(decision.reason, kind);
  return decision;
}

export async function verifyFolderForAddChild(
  folderId: string,
  ready: { connection: CompanyGoogleConnection; accessToken: string },
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; file: CompanyDriveFile; basis: CompanyStorageBasis } | CompanySheetsFailure> {
  if (!hasScope(ready.connection, COMPANY_GOOGLE_DRIVE_METADATA_SCOPE)) return fail("drive_scope_required");
  const drive = await loadDriveFile(folderId, ready.accessToken, deps);
  if (!drive.ok) return mapStorageReason(drive.reason, "folder");
  if (drive.file.id !== folderId) return fail("invalid_folder");
  if (drive.file.mimeType !== COMPANY_DRIVE_FOLDER_MIME) return fail("invalid_folder");
  const stored = await evaluateStoredFile(
    drive.file,
    "add_child",
    ready.connection.googleEmail,
    ready.accessToken,
    deps,
    env,
    "folder"
  );
  if (!stored.ok) {
    if (stored.code === "not_company_controlled" && !drive.file.driveId) return fail("folder_not_company_owned");
    return stored;
  }
  return { ok: true, file: drive.file, basis: stored.basis };
}

const COMPANY_STORAGE_LOCK_TIMEOUT_MS = 45_000;
const COMPANY_STORAGE_LOCK_MAX_WAIT_MS = 5_000;

function storagePolicyComplete(config: CompanyStorageConfig): boolean {
  return Boolean(config.approvedSharedDriveId && config.approvedParentFolderId);
}

function controlBasisForAdopted(basis: CompanyStorageBasis): CompanySheetsControlBasis {
  return basis === "approved_shared_drive" ? "approved_shared_drive" : "drive_owner_verified";
}

/**
 * Holds one transaction-scoped advisory lock across the lookup and a single
 * create. The lock is not nested: folder placement finishes before a
 * spreadsheet placement starts. Session-level advisory locks are not used.
 */
async function withCompanyStorageLock<T>(db: PrismaClient, key: string, fn: () => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return fn();
  }, { timeout: COMPANY_STORAGE_LOCK_TIMEOUT_MS, maxWait: COMPANY_STORAGE_LOCK_MAX_WAIT_MS });
}

async function listNamedChildren(
  input: { parentId: string; name: string; mimeType: string; driveId: string | null; accessToken: string },
  deps: CompanySheetsDeps
): Promise<{ ok: true; files: CompanyDriveFile[] } | { ok: false; reason: CompanyDriveHttpFailure | "ambiguous" }> {
  if (deps.findNamedChild) return deps.findNamedChild(input, deps.fetchImpl);
  if (input.mimeType === COMPANY_DRIVE_FOLDER_MIME && input.driveId && deps.findChildFolder) {
    const found = await deps.findChildFolder(
      { parentId: input.parentId, name: input.name, driveId: input.driveId, accessToken: input.accessToken },
      deps.fetchImpl
    );
    if (found.ok) return { ok: true, files: found.files };
    if (found.reason === "ambiguous_client_folder") return { ok: false, reason: "ambiguous" };
    return { ok: false, reason: found.reason };
  }
  return findCompanyDriveNamedChild(input, deps.fetchImpl);
}

function ambiguousNameCode(kind: "spreadsheet" | "folder"): CompanySheetsError {
  return kind === "folder" ? "ambiguous_client_folder" : "ambiguous_spreadsheet";
}

type PlacedNamedFile = {
  ok: true;
  file: CompanyDriveFile;
  created: boolean;
  basis: CompanyStorageBasis;
};

/**
 * Lists one exact name under the verified parent, then creates at most once
 * in that parent. Name equality is not a uniqueness guarantee. An ambiguous
 * create response is listed once more and never creates a second file.
 */
async function placeNamedFile(
  input: {
    parentId: string;
    driveId: string | null;
    name: string;
    mimeType: string;
    operation: CompanyStorageOperation;
    kind: "spreadsheet" | "folder";
    lockKey: string;
  },
  ready: { connection: CompanyGoogleConnection; accessToken: string },
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv,
  db: PrismaClient
): Promise<PlacedNamedFile | CompanySheetsFailure> {
  const config = readCompanyStorageConfig(env);
  if (storagePolicyComplete(config)) {
    if (!input.driveId || input.driveId !== config.approvedSharedDriveId) return fail("outside_approved_parent");
  } else if (input.driveId) {
    return fail("approved_drive_unconfigured");
  }
  return withCompanyStorageLock(db, input.lockKey, async () => {
    const listed = await listNamedChildren(
      {
        parentId: input.parentId,
        name: input.name,
        mimeType: input.mimeType,
        driveId: input.driveId,
        accessToken: ready.accessToken,
      },
      deps
    );
    if (!listed.ok) {
      if (listed.reason === "ambiguous") return fail(ambiguousNameCode(input.kind));
      if (listed.reason === "access_denied") return fail("child_lookup_unsupported");
      return mapStorageReason(listed.reason, input.kind);
    }
    if (listed.files.length > 1) return fail(ambiguousNameCode(input.kind));
    const existing = listed.files[0];
    if (existing) return adoptNamedFile(existing.id, input, ready, deps, env);
    const created = await (deps.createDriveFile ?? createCompanyDriveFile)(
      {
        name: input.name,
        mimeType: input.mimeType,
        parentId: input.parentId,
        accessToken: ready.accessToken,
      },
      deps.fetchImpl
    );
    if (!created.ok) {
      if (
        created.reason === "network_error" ||
        created.reason === "malformed_response" ||
        created.reason === "server_error"
      ) {
        return recoverAmbiguousCreate(input, ready, deps, env, created.reason);
      }
      if (created.reason === "rate_limited") return fail("retryable", true);
      if (created.reason === "unauthorized") return fail("google_reconnect_required");
      return fail("create_placement_failed");
    }
    if (!created.file.parents.includes(input.parentId)) return fail("create_outcome_unknown");
    const confirmed = await adoptNamedFile(created.file.id, input, ready, deps, env);
    if (!confirmed.ok) return fail("create_outcome_unknown");
    return { ...confirmed, created: true };
  });
}

async function recoverAmbiguousCreate(
  input: {
    parentId: string;
    driveId: string | null;
    name: string;
    mimeType: string;
    operation: CompanyStorageOperation;
    kind: "spreadsheet" | "folder";
  },
  ready: { connection: CompanyGoogleConnection; accessToken: string },
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv,
  reason: CompanyDriveHttpFailure
): Promise<PlacedNamedFile | CompanySheetsFailure> {
  const again = await listNamedChildren(
    {
      parentId: input.parentId,
      name: input.name,
      mimeType: input.mimeType,
      driveId: input.driveId,
      accessToken: ready.accessToken,
    },
    deps
  );
  if (!again.ok) {
    if (again.reason === "ambiguous") return fail(ambiguousNameCode(input.kind));
    return fail("create_outcome_unknown");
  }
  if (again.files.length !== 1) {
    if (again.files.length > 1) return fail(ambiguousNameCode(input.kind));
    if (reason === "server_error") return fail("retryable", true);
    return fail("create_outcome_unknown");
  }
  const adopted = await adoptNamedFile(again.files[0].id, input, ready, deps, env);
  if (!adopted.ok) return adopted;
  return { ...adopted, created: false };
}

async function adoptNamedFile(
  fileId: string,
  input: {
    parentId: string;
    name: string;
    mimeType: string;
    operation: CompanyStorageOperation;
    kind: "spreadsheet" | "folder";
  },
  ready: { connection: CompanyGoogleConnection; accessToken: string },
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv
): Promise<PlacedNamedFile | CompanySheetsFailure> {
  const confirmed = await loadDriveFile(fileId, ready.accessToken, deps);
  if (!confirmed.ok) {
    if (confirmed.reason === "network_error" || confirmed.reason === "malformed_response") {
      return fail("create_outcome_unknown");
    }
    return mapStorageReason(confirmed.reason, input.kind);
  }
  const file = confirmed.file;
  if (file.id !== fileId || file.name !== input.name || file.mimeType !== input.mimeType) {
    return fail(ambiguousNameCode(input.kind));
  }
  if (!file.parents.includes(input.parentId)) return fail("outside_approved_parent");
  const stored = await evaluateStoredFile(
    file,
    input.operation,
    ready.connection.googleEmail,
    ready.accessToken,
    deps,
    env,
    input.kind
  );
  if (!stored.ok) return stored;
  if (storagePolicyComplete(readCompanyStorageConfig(env)) && stored.basis !== "approved_shared_drive") {
    return fail("outside_approved_parent");
  }
  return { ok: true, file, created: false, basis: stored.basis };
}

async function resolveCreateFolder(
  clientAccountId: string,
  folderRef: unknown,
  ready: { connection: CompanyGoogleConnection; accessToken: string },
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; folderId: string; driveId: string | null } | CompanySheetsFailure> {
  const config = readCompanyStorageConfig(env);
  if (typeof folderRef === "string" && folderRef.trim()) {
    const parsed = parseCompanyDriveFolderRef(folderRef);
    if (!parsed.ok) return fail("invalid_folder");
    const verified = await verifyFolderForAddChild(parsed.folderId, ready, deps, env);
    if (!verified.ok) return verified;
    if (storagePolicyComplete(config) && verified.basis !== "approved_shared_drive") {
      return fail("outside_approved_parent");
    }
    return { ok: true, folderId: verified.file.id, driveId: verified.file.driveId };
  }
  if (storagePolicyComplete(config)) {
    const ensured = await ensureCompanyClientFolder(clientAccountId, { ...deps, env });
    if (!ensured.ok) return ensured;
    return { ok: true, folderId: ensured.folder.folderId, driveId: config.approvedSharedDriveId };
  }
  if (ready.connection.destinationFolderId && ready.connection.destinationFolderVerifiedAt) {
    const verified = await verifyFolderForAddChild(ready.connection.destinationFolderId, ready, deps, env);
    if (!verified.ok) return verified;
    if (verified.file.driveId) return fail("approved_drive_unconfigured");
    return { ok: true, folderId: verified.file.id, driveId: null };
  }
  return fail("approved_parent_unconfigured");
}

function companyParentMatchesPolicy(file: CompanyDriveFile, config: CompanyStorageConfig): boolean {
  if (!config.approvedSharedDriveId && !config.approvedParentFolderId) return file.driveId == null;
  return Boolean(
    config.approvedSharedDriveId &&
      config.approvedParentFolderId &&
      file.id === config.approvedParentFolderId &&
      file.driveId === config.approvedSharedDriveId
  );
}

export async function verifyCompanyDestinationFolder(
  folder: unknown,
  deps: CompanySheetsDeps = {}
): Promise<{ ok: true; connection: CompanyGoogleConnectionView } | CompanySheetsFailure> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const parsed = parseCompanyDriveFolderRef(folder);
  if (!parsed.ok) return fail("invalid_folder");
  const db = deps.db ?? prisma;
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const verified = await verifyFolderForAddChild(parsed.folderId, ready, deps, env);
  if (!verified.ok) return verified;
  const config = readCompanyStorageConfig(env);
  if (!companyParentMatchesPolicy(verified.file, config)) return fail("not_approved_parent");
  const connection = await setCompanyDestinationFolder(
    {
      id: ready.connection.id,
      folderId: verified.file.id,
      title: verified.file.name,
      verifiedAt: deps.now?.() ?? new Date(),
    },
    db
  );
  return { ok: true, connection };
}

export async function clearVerifiedCompanyDestinationFolder(
  deps: CompanySheetsDeps = {}
): Promise<{ ok: true; connection: CompanyGoogleConnectionView; existingSpreadsheetsRemainInPlace: true } | CompanySheetsFailure> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const connection = await findCompanyGoogleConnection(db);
  if (!connection) return fail("google_not_connected");
  const view = await clearCompanyDestinationFolder(connection.id, db);
  return { ok: true, connection: view, existingSpreadsheetsRemainInPlace: true };
}

export async function companySheetsSetupStatus(deps: CompanySheetsDeps = {}) {
  return getCompanyGoogleConnection(deps.db ?? prisma);
}
