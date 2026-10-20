import type { CompanyGoogleConnection, CompanySheetsDestination, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_GOOGLE_DRIVE_FILE_SCOPE,
  COMPANY_GOOGLE_DRIVE_METADATA_SCOPE,
  COMPANY_GOOGLE_SPREADSHEETS_SCOPE,
  COMPANY_SHEETS_DEFAULT_WORKSHEET_TITLE,
  COMPANY_SHEETS_DELIVERY_EXECUTION_DISABLED,
  COMPANY_SHEETS_WRITE_READINESS_NOT_VERIFIED,
  deriveCompanySheetsControl,
  grantedScopeList,
  isCompanyGoogleSheetsEnabled,
  parseCompanyDriveFolderRef,
  parseIntendedRecipientEmail,
  projectCompanySheetsSharing,
  type CompanySheetsSharingProjection,
} from "../../lib/company-google-sheets-env.js";
import {
  buildSafeSpreadsheetUrl,
  isSafeGoogleSpreadsheetUrl,
  parseGoogleWorksheetId,
} from "../../lib/google-sheets-env.js";
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
  companyAccountOwnsDriveFile,
  getCompanyDriveFile,
  moveCompanyDriveFileToFolder,
  type CompanyDriveHttpFailure,
} from "./company-google-drive-http.js";
import {
  createSpreadsheet,
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
  | "ownership_unverified"
  | "drive_scope_required"
  | "spreadsheets_scope_required"
  | "destination_folder_unverified"
  | "folder_not_company_owned"
  | "spreadsheet_bound_to_other_client"
  | "destination_conflict"
  | "create_outcome_unknown"
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
};

export type CompanySheetsDeps = {
  env?: NodeJS.ProcessEnv;
  db?: PrismaClient;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  getAccessToken?: typeof getValidCompanyGoogleAccessToken;
  getMetadata?: typeof getSpreadsheetMetadata;
  createSpreadsheet?: typeof createSpreadsheet;
  getDriveFile?: typeof getCompanyDriveFile;
  moveDriveFile?: typeof moveCompanyDriveFileToFolder;
};

const TITLE_MAX = 120;

export function companySheetsErrorStatus(code: CompanySheetsError): number {
  switch (code) {
    case "destination_disabled":
    case "client_not_found":
    case "spreadsheet_unavailable":
    case "worksheet_unavailable":
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
    case "ownership_unverified":
    case "destination_folder_unverified":
    case "folder_not_company_owned":
    case "spreadsheet_bound_to_other_client":
    case "destination_conflict":
    case "create_outcome_unknown":
      return 409;
    case "access_denied":
    case "drive_scope_required":
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

export function presentCompanySheetsDestination(
  row: CompanySheetsDestination,
  connection: CompanyGoogleConnection | null
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

function mapDrive(reason: CompanyDriveHttpFailure): CompanySheetsFailure {
  switch (reason) {
    case "unauthorized":
      return fail("google_reconnect_required");
    case "access_denied":
      return fail("access_denied");
    case "not_found":
      return fail("spreadsheet_unavailable");
    case "rate_limited":
    case "server_error":
    case "network_error":
      return fail("retryable", true);
    default:
      return fail("provider_error");
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

async function loadReadyConnection(
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

async function establishControl(
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
      controlBasis: "company_created" | "drive_owner_verified";
      creationId: string | null;
    }
  | CompanySheetsFailure
> {
  const db = deps.db ?? prisma;
  const creation = await findCompanySpreadsheetCreation(input.spreadsheetId, db);
  const creationMarker = Boolean(
    creation && creation.companyConnectionId === input.connection.id
  );
  let driveOwnerMatch: boolean | null = null;
  if (!hasScope(input.connection, COMPANY_GOOGLE_DRIVE_METADATA_SCOPE)) {
    driveOwnerMatch = null;
    if (!creationMarker) return fail("drive_scope_required");
  } else {
    const drive = await (deps.getDriveFile ?? getCompanyDriveFile)(
      { fileId: input.spreadsheetId, accessToken: input.accessToken },
      deps.fetchImpl
    );
    if (!drive.ok) {
      if (drive.reason === "unauthorized") return fail("google_reconnect_required");
      if (drive.reason === "rate_limited" || drive.reason === "server_error" || drive.reason === "network_error") {
        return fail("retryable", true);
      }
      driveOwnerMatch = null;
    } else if (drive.file.mimeType !== "application/vnd.google-apps.spreadsheet") {
      return fail("invalid_spreadsheet_ref");
    } else {
      driveOwnerMatch = companyAccountOwnsDriveFile(drive.file, input.connection.googleEmail);
    }
  }
  const control = deriveCompanySheetsControl({ creationMarker, driveOwnerMatch });
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
  return { ok: true, destination: presentCompanySheetsDestination(row, connection) };
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
        controlBasis: "company_created" | "drive_owner_verified";
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
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      spreadsheet: {
        spreadsheetId: string;
        title: string;
        spreadsheetUrl: string;
        worksheet: { sheetId: number; title: string };
        controlBasis: "company_created";
        folderPlacement: string;
        destinationSaved: false;
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
  const created = await (deps.createSpreadsheet ?? createSpreadsheet)(
    {
      title: sanitized.title,
      worksheetTitle: COMPANY_SHEETS_DEFAULT_WORKSHEET_TITLE,
      accessToken: ready.accessToken,
    },
    deps.fetchImpl
  );
  if (!created.ok) {
    if (created.reason === "network_error") return fail("create_outcome_unknown");
    return mapSheets(created.reason);
  }
  const worksheet = created.metadata.worksheets[0];
  if (!worksheet) return fail("provider_error");

  let folderPlacement = "root_unconfigured";
  let folderId: string | null = null;
  if (ready.connection.destinationFolderId && ready.connection.destinationFolderVerifiedAt) {
    folderId = ready.connection.destinationFolderId;
    if (!hasScope(ready.connection, COMPANY_GOOGLE_DRIVE_FILE_SCOPE)) {
      folderPlacement = "placement_unavailable_missing_scope";
    } else {
      const moved = await (deps.moveDriveFile ?? moveCompanyDriveFileToFolder)(
        {
          fileId: created.metadata.spreadsheetId,
          folderId,
          accessToken: ready.accessToken,
        },
        deps.fetchImpl
      );
      folderPlacement = moved.ok ? "placed" : "placement_failed";
    }
  }

  try {
    await insertCompanySpreadsheetCreation(
      {
        companyConnectionId: ready.connection.id,
        spreadsheetId: created.metadata.spreadsheetId,
        spreadsheetTitle: created.metadata.title,
        spreadsheetUrl: created.metadata.spreadsheetUrl,
        worksheetId: worksheet.sheetId,
        worksheetTitle: worksheet.title,
        folderId,
        folderPlacement,
        createdByActor: actor,
      },
      db
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "P2002") return fail("provider_error");
  }

  return {
    ok: true,
    spreadsheet: {
      spreadsheetId: created.metadata.spreadsheetId,
      title: created.metadata.title,
      spreadsheetUrl: created.metadata.spreadsheetUrl,
      worksheet: { sheetId: worksheet.sheetId, title: worksheet.title },
      controlBasis: "company_created",
      folderPlacement,
      destinationSaved: false,
      writable: false,
    },
  };
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
  const existing = await findCompanySheetsDestinationByClient(clientAccountId, db);
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
  await deleteCompanySheetsDestination(clientAccountId, db);
  return { ok: true, destination: null };
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
  if (!hasScope(ready.connection, COMPANY_GOOGLE_DRIVE_METADATA_SCOPE)) {
    return fail("drive_scope_required");
  }
  const drive = await (deps.getDriveFile ?? getCompanyDriveFile)(
    { fileId: parsed.folderId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!drive.ok) return mapDrive(drive.reason);
  if (drive.file.mimeType !== "application/vnd.google-apps.folder") return fail("invalid_folder");
  if (!companyAccountOwnsDriveFile(drive.file, ready.connection.googleEmail)) {
    return fail("folder_not_company_owned");
  }
  const connection = await setCompanyDestinationFolder(
    {
      id: ready.connection.id,
      folderId: drive.file.id,
      title: drive.file.name,
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
