/**
 * Save an intended Company Sheets spreadsheet id and GRID worksheet id.
 *
 * The row is a configuration request. It is not a CompanySheetsDestination
 * write. Delivery, dispatch, tab contracts, column maps, and fulfillment do
 * not read this table. An inactive destination is still operational: lead
 * enqueue, aged release, captured-test jobs, access tests, write probes, and
 * tab inspect can use it while dispatch is off. This service does not call
 * those writers.
 *
 * Company control is establishControl. A readable URL is not ownership.
 * Drive metadata, ancestry, shortcut rejection, trash, and edit capability
 * are checked before the database transaction. That check can refresh an
 * expired company access token through the existing compare-and-set. It does
 * not create a Drive file, change scopes, or change the destination.
 *
 * The Google read is not repeated inside the row locks. A file can move,
 * lose permission, or be trashed after controlCheckedAt and before a later
 * operational apply. Any apply step must call establishControl again and
 * reject the request when the file no longer matches. This table does not
 * perform that apply.
 */

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { parseGoogleSpreadsheetRef } from "../lib/google-spreadsheet-ref.js";
import { acceptedOnboardingActor } from "../lib/onboarding-staff-actor.js";
import { isCompanySheetsConfigRequestEnabled } from "../lib/company-sheets-config-request-env.js";
import type { CompanySheetsControlBasis } from "../lib/company-google-sheets-env.js";
import { getSpreadsheetMetadata } from "./google-sheets/google-sheets-http-client.js";
import {
  establishControl,
  loadReadyConnection,
  type CompanySheetsDeps,
  type CompanySheetsFailure,
} from "./company-google/company-sheets-destination.service.js";

const TRANSACTION = { timeout: 10_000 } as const;
const TITLE_MAX = 200;

const BOUNDARY = {
  operationalWrite: false as const,
  destinationUpdated: false as const,
  dispatchChanged: false as const,
  driveChanged: false as const,
  tabContractChanged: false as const,
  columnMapPublished: false as const,
  deliveryArmed: false as const,
  routingChanged: false as const,
  fulfillmentChanged: false as const,
};

export type CompanySheetsConfigCommand = {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  expectedDestinationRevision: number | null;
  spreadsheetId: string;
  worksheetId: number;
};

export type OperationalDestinationFact = {
  exists: boolean;
  destinationRevision: number | null;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
};

export type CompanySheetsConfigSuccess = {
  ok: true;
  requestId: string;
  revision: number;
  replayed: boolean;
  status: "stored";
  spreadsheetId: string;
  worksheetId: number;
  spreadsheetTitle: string;
  worksheetTitle: string;
  controlBasis: CompanySheetsControlBasis;
  controlCheckedAt: string;
  expectedDestinationRevision: number | null;
  operationalDestination: OperationalDestinationFact;
} & typeof BOUNDARY;

export type CompanySheetsConfigFailure = {
  ok: false;
  statusCode: 400 | 403 | 404 | 409 | 502 | 503;
  error: string;
  replayed: false;
  requestId: string | null;
  revision: number | null;
} & typeof BOUNDARY;

export type CompanySheetsConfigResult = CompanySheetsConfigSuccess | CompanySheetsConfigFailure;

export type CompanySheetsConfigHead = {
  ok: true;
  clientAccountId: string;
  revision: number;
  operationalDestination: OperationalDestinationFact;
  configuration: {
    requestId: string;
    revision: number;
    spreadsheetId: string;
    worksheetId: number;
    spreadsheetTitle: string;
    worksheetTitle: string;
    controlBasis: string;
    controlCheckedAt: string;
    expectedDestinationRevision: number | null;
    createdAt: string;
  } | null;
} & typeof BOUNDARY;

export type CompanySheetsConfigDeps = {
  now?: Date;
  /** Omitted means the shared admin actor. An unrecognized value is refused. */
  actor?: string;
  sheets?: CompanySheetsDeps;
  /**
   * Test-only hook. It runs after the request-chain check and before the
   * destination version is read again. Production routes do not pass it.
   * A thrown failure aborts the transaction, so a mutation made here rolls back.
   */
  afterDestinationLock?: (tx: Prisma.TransactionClient, clientAccountId: string) => Promise<void>;
};

type VerifiedSheet = {
  spreadsheetId: string;
  worksheetId: number;
  spreadsheetTitle: string;
  worksheetTitle: string;
  controlBasis: CompanySheetsControlBasis;
  companyConnectionId: string;
  controlCheckedAt: Date;
};

class ConfigRequestAbort extends Error {
  constructor(readonly result: CompanySheetsConfigFailure) {
    super(result.error);
  }
}

export async function readCompanySheetsConfigHead(
  db: PrismaClient,
  clientAccountId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<CompanySheetsConfigHead | CompanySheetsConfigFailure> {
  if (!isCompanySheetsConfigRequestEnabled(env)) return failure(404, "feature_disabled");
  const id = clientAccountId.trim();
  if (!id) return failure(404, "client_not_found");
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: { clientAccountId: true },
  });
  if (!client) return failure(404, "client_not_found");
  const [destination, open, max] = await Promise.all([
    db.companySheetsDestination.findUnique({
      where: { clientAccountId: id },
      select: {
        destinationRevision: true,
        campaignDispatchEnabled: true,
        agedDispatchEnabled: true,
      },
    }),
    db.companySheetsDestinationConfigurationRequest.findFirst({
      where: { clientAccountId: id, status: "stored" },
    }),
    db.companySheetsDestinationConfigurationRequest.aggregate({
      where: { clientAccountId: id },
      _max: { revision: true },
    }),
  ]);
  return {
    ...BOUNDARY,
    ok: true,
    clientAccountId: id,
    revision: max._max.revision ?? 0,
    operationalDestination: presentDestination(destination),
    configuration: open
      ? {
          requestId: open.requestId,
          revision: open.revision,
          spreadsheetId: open.spreadsheetId,
          worksheetId: open.worksheetId,
          spreadsheetTitle: open.spreadsheetTitle,
          worksheetTitle: open.worksheetTitle,
          controlBasis: open.controlBasis,
          controlCheckedAt: open.controlCheckedAt.toISOString(),
          expectedDestinationRevision: open.expectedDestinationRevision,
          createdAt: open.createdAt.toISOString(),
        }
      : null,
  };
}

export async function recordCompanySheetsConfigRequest(
  db: PrismaClient,
  command: CompanySheetsConfigCommand,
  env: NodeJS.ProcessEnv = process.env,
  deps: CompanySheetsConfigDeps = {}
): Promise<CompanySheetsConfigResult> {
  if (!isCompanySheetsConfigRequestEnabled(env)) return failure(404, "feature_disabled");
  const clientAccountId = command.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found", command.requestId);
  const normalized = normalize(command, clientAccountId);
  const shape = validateShape(normalized);
  if (shape) return shape;
  const actor = acceptedOnboardingActor(deps.actor);
  if (!actor) return failure(403, "actor_rejected", command.requestId);

  const earlyReplay = await db.companySheetsDestinationConfigurationRequest.findUnique({
    where: { requestId: normalized.requestId },
  });
  if (earlyReplay) {
    return replayStored(db, earlyReplay, normalized);
  }

  const verified = await verifyControlledWorksheet(db, normalized, env, deps);
  if (!verified.ok) return verified;

  try {
    return await db.$transaction(
      (tx) => applyCommand(tx, normalized, verified.sheet, deps, actor),
      TRANSACTION
    );
  } catch (error) {
    if (error instanceof ConfigRequestAbort) return error.result;
    if (isUniqueConflict(error)) return failure(409, "revision_conflict", command.requestId);
    if (isLockTimeout(error)) return failure(409, "destination_busy", command.requestId);
    throw error;
  }
}

async function applyCommand(
  tx: Prisma.TransactionClient,
  command: CompanySheetsConfigCommand,
  verified: VerifiedSheet,
  deps: CompanySheetsConfigDeps,
  actor: string
): Promise<CompanySheetsConfigSuccess> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`;
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtext(${command.requestId}))
  `;
  const lockedClient = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId"
    FROM "ClientAccount"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;
  if (lockedClient.length === 0) abort(failure(404, "client_not_found", command.requestId));
  await tx.$queryRaw`
    SELECT "id"
    FROM "CompanySheetsDestination"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT "id"
    FROM "CompanySheetsDestinationConfigurationRequest"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;

  const replay = await replayCommand(tx, command);
  if (replay) return attachDestination(tx, command.clientAccountId, replay);

  const currentRevision = await headRevision(tx, command.clientAccountId);
  if (command.expectedRevision !== currentRevision) {
    abort(failure(409, "revision_conflict", command.requestId));
  }

  if (deps.afterDestinationLock) {
    await deps.afterDestinationLock(tx, command.clientAccountId);
  }

  const destination = await tx.companySheetsDestination.findUnique({
    where: { clientAccountId: command.clientAccountId },
    select: {
      destinationRevision: true,
      campaignDispatchEnabled: true,
      agedDispatchEnabled: true,
      spreadsheetId: true,
    },
  });
  const actualRevision = destination?.destinationRevision ?? null;
  if (actualRevision !== command.expectedDestinationRevision) {
    abort(failure(409, "destination_stale", command.requestId));
  }

  const bound = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId"
    FROM "CompanySheetsDestination"
    WHERE "spreadsheetId" = ${verified.spreadsheetId}
    FOR SHARE
  `;
  const owner = bound[0];
  if (owner && owner.clientAccountId !== command.clientAccountId) {
    abort(failure(409, "spreadsheet_bound_to_other_client", command.requestId));
  }

  const revision = currentRevision + 1;
  const now = deps.now ?? new Date();
  const open = await tx.companySheetsDestinationConfigurationRequest.findFirst({
    where: { clientAccountId: command.clientAccountId, status: "stored" },
  });
  const stored: Omit<CompanySheetsConfigSuccess, "operationalDestination" | "replayed"> & { replayed: false } = {
    ...BOUNDARY,
    ok: true,
    requestId: command.requestId,
    revision,
    replayed: false,
    status: "stored",
    spreadsheetId: verified.spreadsheetId,
    worksheetId: verified.worksheetId,
    spreadsheetTitle: verified.spreadsheetTitle,
    worksheetTitle: verified.worksheetTitle,
    controlBasis: verified.controlBasis,
    controlCheckedAt: verified.controlCheckedAt.toISOString(),
    expectedDestinationRevision: command.expectedDestinationRevision,
  };
  if (open) {
    await tx.companySheetsDestinationConfigurationRequest.update({
      where: { id: open.id },
      data: {
        status: "superseded",
        supersededAt: now,
        supersededByRequestId: command.requestId,
      },
    });
  }
  await tx.companySheetsDestinationConfigurationRequest.create({
    data: {
      requestId: command.requestId,
      clientAccountId: command.clientAccountId,
      historicalClientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      revision,
      expectedDestinationRevision: command.expectedDestinationRevision,
      spreadsheetId: verified.spreadsheetId,
      worksheetId: verified.worksheetId,
      spreadsheetTitle: verified.spreadsheetTitle,
      worksheetTitle: verified.worksheetTitle,
      controlBasis: verified.controlBasis,
      companyConnectionId: verified.companyConnectionId,
      controlCheckedAt: verified.controlCheckedAt,
      status: "stored",
      payloadHash: commandHash(command),
      recordResultJson: stored,
      actor,
    },
  });
  return {
    ...stored,
    operationalDestination: presentDestination(destination),
  };
}

async function verifyControlledWorksheet(
  db: PrismaClient,
  command: CompanySheetsConfigCommand,
  env: NodeJS.ProcessEnv,
  deps: CompanySheetsConfigDeps
): Promise<{ ok: true; sheet: VerifiedSheet } | CompanySheetsConfigFailure> {
  const sheets: CompanySheetsDeps = { ...deps.sheets, env, db };
  const ready = await loadReadyConnection(sheets);
  if (!ready.ok) return fromSheets(ready, command.requestId);
  const metadataResult = await (sheets.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: command.spreadsheetId, accessToken: ready.accessToken },
    sheets.fetchImpl
  );
  if (!metadataResult.ok) return fromSheets(mapMetadata(metadataResult.reason), command.requestId);
  if (metadataResult.metadata.spreadsheetId !== command.spreadsheetId) {
    return failure(409, "ownership_unverified", command.requestId);
  }
  const control = await establishControl(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: command.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    sheets
  );
  if (!control.ok) return fromSheets(control, command.requestId);
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === command.worksheetId) ?? null;
  if (!worksheet) return failure(404, "worksheet_unavailable", command.requestId);
  if (worksheet.sheetType !== "GRID") return failure(400, "worksheet_not_grid", command.requestId);
  return {
    ok: true,
    sheet: {
      spreadsheetId: command.spreadsheetId,
      worksheetId: command.worksheetId,
      spreadsheetTitle: displayTitle(metadataResult.metadata.title, command.spreadsheetId),
      worksheetTitle: displayTitle(worksheet.title, `Worksheet ${command.worksheetId}`),
      controlBasis: control.controlBasis,
      companyConnectionId: ready.connection.id,
      controlCheckedAt: deps.now ?? new Date(),
    },
  };
}

function mapMetadata(reason: string): CompanySheetsFailure {
  switch (reason) {
    case "unauthorized":
      return { ok: false, code: "google_reconnect_required", statusCode: 409, retryable: false };
    case "access_denied":
      return { ok: false, code: "access_denied", statusCode: 403, retryable: false };
    case "not_found":
      return { ok: false, code: "spreadsheet_unavailable", statusCode: 404, retryable: false };
    case "invalid_request":
      return { ok: false, code: "invalid_spreadsheet_ref", statusCode: 400, retryable: false };
    case "rate_limited":
    case "server_error":
    case "network_error":
      return { ok: false, code: "retryable", statusCode: 503, retryable: true };
    default:
      return { ok: false, code: "provider_error", statusCode: 502, retryable: false };
  }
}

function fromSheets(result: CompanySheetsFailure, requestId: string): CompanySheetsConfigFailure {
  const statusCode = result.statusCode;
  if (
    statusCode === 400 ||
    statusCode === 403 ||
    statusCode === 404 ||
    statusCode === 409 ||
    statusCode === 502 ||
    statusCode === 503
  ) {
    return failure(statusCode, result.code, requestId);
  }
  return failure(502, "provider_error", requestId);
}

async function replayStored(
  db: PrismaClient,
  existing: { clientAccountId: string; payloadHash: string; recordResultJson: Prisma.JsonValue },
  command: CompanySheetsConfigCommand
): Promise<CompanySheetsConfigResult> {
  const parsed = parseReplay(existing, command);
  if (!parsed.ok) return parsed;
  return attachDestination(db, command.clientAccountId, parsed);
}

async function replayCommand(
  tx: Prisma.TransactionClient,
  command: CompanySheetsConfigCommand
): Promise<CompanySheetsConfigSuccess | null> {
  const existing = await tx.companySheetsDestinationConfigurationRequest.findUnique({
    where: { requestId: command.requestId },
  });
  if (!existing) return null;
  const parsed = parseReplay(existing, command);
  if (!parsed.ok) abort(parsed);
  return parsed;
}

function parseReplay(
  existing: { clientAccountId: string; payloadHash: string; recordResultJson: Prisma.JsonValue },
  command: CompanySheetsConfigCommand
): CompanySheetsConfigSuccess | CompanySheetsConfigFailure {
  if (existing.clientAccountId !== command.clientAccountId || existing.payloadHash !== commandHash(command)) {
    return failure(409, "request_id_reused", command.requestId);
  }
  const stored = existing.recordResultJson;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return failure(409, "request_id_reused", command.requestId);
  }
  const row = stored as Partial<CompanySheetsConfigSuccess>;
  if (row.ok !== true || row.spreadsheetId !== command.spreadsheetId || row.worksheetId !== command.worksheetId) {
    return failure(409, "request_id_reused", command.requestId);
  }
  return { ...(stored as CompanySheetsConfigSuccess), replayed: true };
}

async function attachDestination(
  db: PrismaClient | Prisma.TransactionClient,
  clientAccountId: string,
  result: CompanySheetsConfigSuccess
): Promise<CompanySheetsConfigSuccess> {
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId },
    select: {
      destinationRevision: true,
      campaignDispatchEnabled: true,
      agedDispatchEnabled: true,
    },
  });
  return { ...result, replayed: true, operationalDestination: presentDestination(destination), ...BOUNDARY };
}

function presentDestination(
  destination: {
    destinationRevision: number;
    campaignDispatchEnabled: boolean;
    agedDispatchEnabled: boolean;
  } | null
): OperationalDestinationFact {
  if (!destination) {
    return { exists: false, destinationRevision: null, campaignDispatchEnabled: false, agedDispatchEnabled: false };
  }
  return {
    exists: true,
    destinationRevision: destination.destinationRevision,
    campaignDispatchEnabled: destination.campaignDispatchEnabled,
    agedDispatchEnabled: destination.agedDispatchEnabled,
  };
}

function normalize(command: CompanySheetsConfigCommand, clientAccountId: string): CompanySheetsConfigCommand {
  const parsed = parseGoogleSpreadsheetRef(command.spreadsheetId);
  return {
    ...command,
    clientAccountId,
    spreadsheetId: parsed.ok ? parsed.spreadsheetId : command.spreadsheetId.trim(),
  };
}

function validateShape(command: CompanySheetsConfigCommand): CompanySheetsConfigFailure | null {
  const parsed = parseGoogleSpreadsheetRef(command.spreadsheetId);
  if (!parsed.ok || parsed.spreadsheetId !== command.spreadsheetId) {
    return failure(400, "invalid_spreadsheet_ref", command.requestId);
  }
  if (!Number.isInteger(command.worksheetId) || command.worksheetId < 0 || command.worksheetId > 2_147_483_647) {
    return failure(400, "invalid_worksheet", command.requestId);
  }
  if (
    command.expectedDestinationRevision !== null &&
    (!Number.isInteger(command.expectedDestinationRevision) || command.expectedDestinationRevision < 1)
  ) {
    return failure(400, "invalid_body", command.requestId);
  }
  return null;
}

function commandHash(command: CompanySheetsConfigCommand): string {
  return createHash("sha256")
    .update(JSON.stringify({
      clientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      expectedDestinationRevision: command.expectedDestinationRevision,
      spreadsheetId: command.spreadsheetId,
      worksheetId: command.worksheetId,
    }))
    .digest("hex");
}

function displayTitle(raw: string, fallback: string): string {
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const chosen = title || fallback;
  return chosen.length > TITLE_MAX ? chosen.slice(0, TITLE_MAX).trim() : chosen;
}

async function headRevision(tx: Prisma.TransactionClient, clientAccountId: string): Promise<number> {
  const max = await tx.companySheetsDestinationConfigurationRequest.aggregate({
    where: { clientAccountId },
    _max: { revision: true },
  });
  return max._max.revision ?? 0;
}

function failure(
  statusCode: CompanySheetsConfigFailure["statusCode"],
  error: string,
  requestId: string | null = null
): CompanySheetsConfigFailure {
  return { ...BOUNDARY, ok: false, statusCode, error, replayed: false, requestId, revision: null };
}

function abort(result: CompanySheetsConfigFailure): never {
  throw new ConfigRequestAbort(result);
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function isLockTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null ? error.meta : null;
  const metaCode = meta && "code" in meta ? meta.code : undefined;
  if (metaCode === "55P03") return true;
  return error instanceof Error && /lock timeout|55P03/i.test(error.message);
}
