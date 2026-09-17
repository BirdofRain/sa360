import type { DeliveryTarget, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { validateDeliveryTargetMetadata } from "../../lib/delivery-target-metadata.validation.js";
import {
  GOOGLE_SHEETS_DEFAULT_SPREADSHEET_TITLE,
  GOOGLE_SHEETS_DEFAULT_WORKSHEET_TITLE,
  GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY,
  GOOGLE_SHEETS_HEADER_SCHEMA_VERSION,
  GOOGLE_SHEETS_READINESS_CONFIGURED,
  GOOGLE_SHEETS_TARGET_DISPLAY_NAME,
  isGoogleSheetsDestinationEnabled,
  isSafeGoogleSpreadsheetUrl,
} from "../../lib/google-sheets-env.js";
import { parseGoogleSpreadsheetRef } from "../../lib/google-spreadsheet-ref.js";
import { payloadContainsPlaintextSecret, assertNoTokenFieldsInPayload } from "../../lib/token-field-denylist.js";
import {
  createDeliveryTargetRecord,
  findGoogleSheetsDeliveryTargetsForClient,
  updateDeliveryTargetRecord,
} from "../../repositories/delivery-target.repository.js";
import {
  getValidGoogleAccessToken,
  type GoogleAccessTokenDeps,
  type GoogleAccessTokenResult,
} from "../google-oauth/google-access-token.service.js";
import { getGoogleAccountConnectionByClientAccountId } from "../google-oauth/google-connection.service.js";
import { presentGoogleAccountConnection } from "../google-oauth/google-connection.present.js";
import {
  createSpreadsheet,
  getSpreadsheetMetadata,
  type GoogleSpreadsheetMetadata,
  type GoogleSheetsHttpFailure,
  type GoogleSheetsWorksheet,
} from "./google-sheets-http-client.js";

export type GoogleSheetsDestinationError =
  | "destination_disabled"
  | "google_not_connected"
  | "google_reconnect_required"
  | "oauth_not_configured"
  | "invalid_spreadsheet_ref"
  | "invalid_title"
  | "invalid_worksheet"
  | "access_denied"
  | "spreadsheet_unavailable"
  | "worksheet_unavailable"
  | "worksheet_not_grid"
  | "retryable"
  | "provider_error"
  | "metadata_rejected"
  | "destination_in_use";

export type GoogleSheetsDestinationFailure = {
  ok: false;
  code: GoogleSheetsDestinationError;
  statusCode: number;
  retryable: boolean;
};

export type GoogleSheetsConnectionSummary = {
  status: "connected" | "reconnect_required" | "disconnected" | "error";
  connected: boolean;
  reconnectRequired: boolean;
};

export type GoogleSheetsResolvedSpreadsheet = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  worksheets: Array<{
    sheetId: number;
    title: string;
    index: number;
    hidden?: boolean;
    sheetType?: string;
  }>;
};

export type GoogleSheetsCreatedSpreadsheet = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  worksheet: { sheetId: number; title: string };
  createdBySa360: true;
};

export type GoogleSheetsTestResult = {
  ok: true;
  spreadsheetTitle: string;
  worksheetTitle: string;
  /** Read-only metadata check. Does not prove write permission. */
  readOnlyAccess: true;
  writePermissionVerified: false;
};

export type GoogleSheetsDestinationConfig = {
  configured: true;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  worksheetId: number;
  worksheetTitle: string;
  createdBySa360: boolean;
  headerSchemaVersion: string;
  connection: GoogleSheetsConnectionSummary;
};

export type GoogleSheetsDestinationDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  db?: PrismaClient;
  getAccessToken?: (
    clientAccountId: string,
    deps?: GoogleAccessTokenDeps
  ) => Promise<GoogleAccessTokenResult>;
  getConnection?: typeof getGoogleAccountConnectionByClientAccountId;
  getMetadata?: typeof getSpreadsheetMetadata;
  createSpreadsheet?: typeof createSpreadsheet;
};

const TITLE_MAX_LENGTH = 120;

export function googleSheetsDestinationErrorStatus(code: GoogleSheetsDestinationError): number {
  switch (code) {
    case "destination_disabled":
    case "spreadsheet_unavailable":
    case "worksheet_unavailable":
      return 404;
    case "invalid_spreadsheet_ref":
    case "invalid_title":
    case "invalid_worksheet":
    case "worksheet_not_grid":
    case "metadata_rejected":
      return 400;
    case "google_not_connected":
    case "google_reconnect_required":
    case "destination_in_use":
      return 409;
    case "access_denied":
      return 403;
    case "oauth_not_configured":
    case "retryable":
      return 503;
    default:
      return 502;
  }
}

function fail(
  code: GoogleSheetsDestinationError,
  retryable = code === "retryable"
): GoogleSheetsDestinationFailure {
  return {
    ok: false,
    code,
    statusCode: googleSheetsDestinationErrorStatus(code),
    retryable,
  };
}

function requireEnabled(
  env: NodeJS.ProcessEnv
): GoogleSheetsDestinationFailure | null {
  if (!isGoogleSheetsDestinationEnabled(env)) return fail("destination_disabled");
  return null;
}

function mapAccessTokenFailure(code: Exclude<GoogleAccessTokenResult, { ok: true }>["code"]) {
  if (code === "refresh_retryable") return fail("retryable", true);
  if (code === "provider_error") return fail("provider_error");
  return fail(code);
}

function mapSheetsFailure(
  reason: GoogleSheetsHttpFailure,
  kind: "spreadsheet" | "worksheet" = "spreadsheet"
): GoogleSheetsDestinationFailure {
  switch (reason) {
    case "unauthorized":
      return fail("google_reconnect_required");
    case "access_denied":
      return fail("access_denied");
    case "not_found":
      return fail(kind === "worksheet" ? "worksheet_unavailable" : "spreadsheet_unavailable");
    case "rate_limited":
    case "server_error":
    case "network_error":
      return fail("retryable", true);
    default:
      return fail("provider_error");
  }
}

function sanitizeTitle(raw: unknown, fallback: string): { ok: true; title: string } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, title: fallback };
  }
  if (typeof raw !== "string") return { ok: false };
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!title || title.length > TITLE_MAX_LENGTH) return { ok: false };
  return { ok: true, title };
}

function connectionSummary(
  status: GoogleSheetsConnectionSummary["status"]
): GoogleSheetsConnectionSummary {
  return {
    status,
    connected: status === "connected",
    reconnectRequired: status === "reconnect_required",
  };
}

function presentWorksheets(worksheets: GoogleSheetsWorksheet[]) {
  return worksheets.map((sheet) => ({
    sheetId: sheet.sheetId,
    title: sheet.title,
    index: sheet.index,
    hidden: sheet.hidden,
    sheetType: sheet.sheetType,
  }));
}

function findGridWorksheet(
  metadata: GoogleSpreadsheetMetadata,
  worksheetId: number
): GoogleSheetsWorksheet | null {
  return (
    metadata.worksheets.find((sheet) => sheet.sheetId === worksheetId && sheet.sheetType === "GRID") ??
    null
  );
}

async function requireUsableConnection(
  clientAccountId: string,
  deps: GoogleSheetsDestinationDeps
): Promise<
  | { ok: true; token: Extract<GoogleAccessTokenResult, { ok: true }> }
  | GoogleSheetsDestinationFailure
> {
  const token = await (deps.getAccessToken ?? getValidGoogleAccessToken)(clientAccountId, {
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    db: deps.db,
  } satisfies GoogleAccessTokenDeps);
  if (!token.ok) return mapAccessTokenFailure(token.code);
  return { ok: true, token };
}

async function loadMetadataOnce(
  spreadsheetId: string,
  accessToken: string,
  deps: GoogleSheetsDestinationDeps
) {
  return (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId, accessToken },
    deps.fetchImpl
  );
}

async function loadMetadataWithUnauthorizedRetry(
  spreadsheetId: string,
  clientAccountId: string,
  token: Extract<GoogleAccessTokenResult, { ok: true }>,
  deps: GoogleSheetsDestinationDeps
): Promise<
  | { ok: true; metadata: GoogleSpreadsheetMetadata; accessToken: string }
  | GoogleSheetsDestinationFailure
> {
  const first = await loadMetadataOnce(spreadsheetId, token.accessToken, deps);
  if (first.ok) return { ok: true, metadata: first.metadata, accessToken: token.accessToken };
  if (first.reason !== "unauthorized") return mapSheetsFailure(first.reason);

  const retriedToken = await (deps.getAccessToken ?? getValidGoogleAccessToken)(clientAccountId, {
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    db: deps.db,
    forceRefresh: true,
  });
  if (!retriedToken.ok) return mapAccessTokenFailure(retriedToken.code);
  const second = await loadMetadataOnce(spreadsheetId, retriedToken.accessToken, deps);
  if (!second.ok) return mapSheetsFailure(second.reason);
  return { ok: true, metadata: second.metadata, accessToken: retriedToken.accessToken };
}

function presentResolved(metadata: GoogleSpreadsheetMetadata): GoogleSheetsResolvedSpreadsheet {
  const spreadsheetUrl = isSafeGoogleSpreadsheetUrl(metadata.spreadsheetUrl, metadata.spreadsheetId)
    ? metadata.spreadsheetUrl
    : `https://docs.google.com/spreadsheets/d/${metadata.spreadsheetId}`;
  return {
    spreadsheetId: metadata.spreadsheetId,
    title: metadata.title,
    spreadsheetUrl,
    worksheets: presentWorksheets(metadata.worksheets),
  };
}

export async function resolveGoogleSpreadsheetForClient(
  clientAccountId: string,
  spreadsheetRef: unknown,
  deps: GoogleSheetsDestinationDeps = {}
): Promise<
  { ok: true; spreadsheet: GoogleSheetsResolvedSpreadsheet } | GoogleSheetsDestinationFailure
> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const parsed = parseGoogleSpreadsheetRef(spreadsheetRef);
  if (!parsed.ok) return fail("invalid_spreadsheet_ref");
  const ready = await requireUsableConnection(clientAccountId, deps);
  if (!ready.ok) return ready;
  const loaded = await loadMetadataWithUnauthorizedRetry(
    parsed.spreadsheetId,
    clientAccountId,
    ready.token,
    deps
  );
  if (!loaded.ok) return loaded;
  return { ok: true, spreadsheet: presentResolved(loaded.metadata) };
}

export async function createSa360SpreadsheetForClient(
  clientAccountId: string,
  titleInput: unknown,
  deps: GoogleSheetsDestinationDeps = {}
): Promise<{ ok: true; spreadsheet: GoogleSheetsCreatedSpreadsheet } | GoogleSheetsDestinationFailure> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const title = sanitizeTitle(titleInput, GOOGLE_SHEETS_DEFAULT_SPREADSHEET_TITLE);
  if (!title.ok) return fail("invalid_title");
  const ready = await requireUsableConnection(clientAccountId, deps);
  if (!ready.ok) return ready;

  const created = await (deps.createSpreadsheet ?? createSpreadsheet)(
    {
      title: title.title,
      worksheetTitle: GOOGLE_SHEETS_DEFAULT_WORKSHEET_TITLE,
      accessToken: ready.token.accessToken,
    },
    deps.fetchImpl
  );
  if (!created.ok) return mapSheetsFailure(created.reason);
  const worksheet =
    created.metadata.worksheets.find(
      (sheet) => sheet.title === GOOGLE_SHEETS_DEFAULT_WORKSHEET_TITLE && sheet.sheetType === "GRID"
    ) ?? created.metadata.worksheets.find((sheet) => sheet.sheetType === "GRID");
  if (!worksheet) return fail("provider_error");
  return {
    ok: true,
    spreadsheet: {
      spreadsheetId: created.metadata.spreadsheetId,
      title: created.metadata.title,
      spreadsheetUrl: presentResolved(created.metadata).spreadsheetUrl,
      worksheet: { sheetId: worksheet.sheetId, title: worksheet.title },
      createdBySa360: true,
    },
  };
}

export async function testGoogleSheetAccessForClient(
  clientAccountId: string,
  input: { spreadsheetId?: unknown; worksheetId?: unknown },
  deps: GoogleSheetsDestinationDeps = {}
): Promise<{ ok: true; result: GoogleSheetsTestResult } | GoogleSheetsDestinationFailure> {
  const env = deps.env ?? process.env;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const parsed = parseGoogleSpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return fail("invalid_spreadsheet_ref");
  const worksheetId =
    typeof input.worksheetId === "number" && Number.isInteger(input.worksheetId) && input.worksheetId >= 0
      ? input.worksheetId
      : null;
  if (worksheetId === null) return fail("invalid_worksheet");
  const ready = await requireUsableConnection(clientAccountId, deps);
  if (!ready.ok) return ready;
  const loaded = await loadMetadataWithUnauthorizedRetry(
    parsed.spreadsheetId,
    clientAccountId,
    ready.token,
    deps
  );
  if (!loaded.ok) return loaded;
  const worksheet = loaded.metadata.worksheets.find((sheet) => sheet.sheetId === worksheetId);
  if (!worksheet) return fail("worksheet_unavailable");
  if (worksheet.sheetType !== "GRID") return fail("worksheet_not_grid");
  return {
    ok: true,
    result: {
      ok: true,
      spreadsheetTitle: loaded.metadata.title,
      worksheetTitle: worksheet.title,
      readOnlyAccess: true,
      writePermissionVerified: false,
    },
  };
}

function readStoredConfig(metadata: unknown): {
  spreadsheetId: string | null;
  spreadsheetTitle: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  createdBySa360: boolean;
  headerSchemaVersion: string | null;
} {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    spreadsheetId: typeof record.spreadsheetId === "string" ? record.spreadsheetId : null,
    spreadsheetTitle: typeof record.spreadsheetTitle === "string" ? record.spreadsheetTitle : null,
    worksheetId:
      typeof record.worksheetId === "number" && Number.isInteger(record.worksheetId)
        ? record.worksheetId
        : null,
    worksheetTitle: typeof record.worksheetTitle === "string" ? record.worksheetTitle : null,
    createdBySa360: record.createdBySa360 === true,
    headerSchemaVersion:
      typeof record.headerSchemaVersion === "string" ? record.headerSchemaVersion : null,
  };
}

export function buildGoogleSheetsDestinationMetadata(input: {
  connectionRefId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  worksheetId: number;
  worksheetTitle: string;
  createdBySa360: boolean;
}): Record<string, unknown> {
  return {
    connectionRefId: input.connectionRefId,
    spreadsheetId: input.spreadsheetId,
    spreadsheetTitle: input.spreadsheetTitle,
    worksheetId: input.worksheetId,
    worksheetTitle: input.worksheetTitle,
    headerSchemaVersion: GOOGLE_SHEETS_HEADER_SCHEMA_VERSION,
    createdBySa360: input.createdBySa360 === true,
  };
}

async function persistGoogleSheetsTarget(
  clientAccountId: string,
  metadata: Record<string, unknown>,
  db: PrismaClient
) {
  const existing = await findGoogleSheetsDeliveryTargetsForClient(clientAccountId, db);
  const primary = existing[0];
  const extras = existing.slice(1);
  const data = {
    displayName: GOOGLE_SHEETS_TARGET_DISPLAY_NAME,
    adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY,
    enabled: false,
    isPrimary: false,
    isRequired: false,
    readinessStatus: GOOGLE_SHEETS_READINESS_CONFIGURED,
    configMetadataJson: metadata,
  };
  let saved: DeliveryTarget;
  if (primary) {
    saved = await updateDeliveryTargetRecord(primary.id, data, db);
  } else {
    saved = await createDeliveryTargetRecord(
      {
        clientAccount: { connect: { clientAccountId } },
        ...data,
      },
      db
    );
  }
  for (const extra of extras) {
    const instructionCount = await db.deliveryInstruction.count({
      where: { deliveryTargetId: extra.id },
    });
    if (instructionCount === 0) {
      await db.deliveryTarget.delete({ where: { id: extra.id } });
    } else {
      await updateDeliveryTargetRecord(
        extra.id,
        { enabled: false, isRequired: false, isPrimary: false },
        db
      );
    }
  }
  return saved;
}

export async function saveGoogleSheetsDestinationForClient(
  clientAccountId: string,
  input: {
    spreadsheetId?: unknown;
    worksheetId?: unknown;
    createdBySa360?: unknown;
  },
  deps: GoogleSheetsDestinationDeps = {}
): Promise<{ ok: true; destination: GoogleSheetsDestinationConfig } | GoogleSheetsDestinationFailure> {
  const env = deps.env ?? process.env;
  const db = deps.db ?? prisma;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const parsed = parseGoogleSpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return fail("invalid_spreadsheet_ref");
  const worksheetId =
    typeof input.worksheetId === "number" && Number.isInteger(input.worksheetId) && input.worksheetId >= 0
      ? input.worksheetId
      : null;
  if (worksheetId === null) return fail("invalid_worksheet");
  const createdBySa360 = input.createdBySa360 === true;

  const ready = await requireUsableConnection(clientAccountId, deps);
  if (!ready.ok) return ready;
  const loaded = await loadMetadataWithUnauthorizedRetry(
    parsed.spreadsheetId,
    clientAccountId,
    ready.token,
    deps
  );
  if (!loaded.ok) return loaded;
  const worksheet = findGridWorksheet(loaded.metadata, worksheetId);
  if (!worksheet) {
    const named = loaded.metadata.worksheets.find((sheet) => sheet.sheetId === worksheetId);
    if (!named) return fail("worksheet_unavailable");
    return fail("worksheet_not_grid");
  }

  const metadata = buildGoogleSheetsDestinationMetadata({
    connectionRefId: ready.token.connectionId,
    spreadsheetId: loaded.metadata.spreadsheetId,
    spreadsheetTitle: loaded.metadata.title,
    worksheetId: worksheet.sheetId,
    worksheetTitle: worksheet.title,
    createdBySa360,
  });
  const validation = validateDeliveryTargetMetadata(metadata);
  if (!validation.ok) return fail("metadata_rejected");
  if (
    payloadContainsPlaintextSecret(metadata, [
      ready.token.accessToken,
      "accessToken",
      "refreshToken",
      "clientSecret",
    ])
  ) {
    return fail("metadata_rejected");
  }

  await persistGoogleSheetsTarget(clientAccountId, metadata, db);
  const current = await getGoogleSheetsDestinationForClient(clientAccountId, deps);
  if (!current.destination.configured) return fail("provider_error");
  return { ok: true, destination: current.destination };
}

export async function getGoogleSheetsDestinationForClient(
  clientAccountId: string,
  deps: GoogleSheetsDestinationDeps = {}
): Promise<{ ok: true; destination: GoogleSheetsDestinationConfig | { configured: false; connection: GoogleSheetsConnectionSummary } }> {
  const db = deps.db ?? prisma;
  const connection = await (deps.getConnection ?? getGoogleAccountConnectionByClientAccountId)(
    clientAccountId,
    db
  );
  const summary = connectionSummary(connection?.status ?? "disconnected");
  const targets = await findGoogleSheetsDeliveryTargetsForClient(clientAccountId, db);
  const target = targets[0];
  if (!target) {
    return { ok: true, destination: { configured: false, connection: summary } };
  }
  const stored = readStoredConfig(target.configMetadataJson);
  const destination: GoogleSheetsDestinationConfig = {
    configured: true,
    spreadsheetId: stored.spreadsheetId ?? "",
    spreadsheetTitle: stored.spreadsheetTitle,
    worksheetId: stored.worksheetId ?? -1,
    worksheetTitle: stored.worksheetTitle ?? "",
    createdBySa360: stored.createdBySa360,
    headerSchemaVersion: stored.headerSchemaVersion ?? GOOGLE_SHEETS_HEADER_SCHEMA_VERSION,
    connection: summary,
  };
  assertNoTokenFieldsInPayload(destination as unknown as Record<string, unknown>);
  return { ok: true, destination };
}

export async function deleteGoogleSheetsDestinationForClient(
  clientAccountId: string,
  deps: GoogleSheetsDestinationDeps = {}
): Promise<{ ok: true; destination: { configured: false; connection: GoogleSheetsConnectionSummary } } | GoogleSheetsDestinationFailure> {
  const env = deps.env ?? process.env;
  const db = deps.db ?? prisma;
  const disabled = requireEnabled(env);
  if (disabled) return disabled;
  const targets = await findGoogleSheetsDeliveryTargetsForClient(clientAccountId, db);
  for (const target of targets) {
    const instructionCount = await db.deliveryInstruction.count({
      where: { deliveryTargetId: target.id },
    });
    if (instructionCount > 0) return fail("destination_in_use");
    await db.deliveryTarget.delete({ where: { id: target.id } });
  }
  const current = await getGoogleSheetsDestinationForClient(clientAccountId, deps);
  if (current.destination.configured) return fail("destination_in_use");
  return { ok: true, destination: current.destination };
}

export { presentGoogleAccountConnection };
