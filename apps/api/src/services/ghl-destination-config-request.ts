/**
 * Save an intended GoHighLevel location, workflow id, and exact field ids.
 *
 * The row is a configuration request. It is not a ClientGhlDestination write.
 * Selected test delivery reads destination workflow and field columns without
 * the four live flags, so this service never updates those columns. A live
 * destination is refused inside the same transaction that would have inserted
 * the request, after the destination row is locked.
 *
 * Field ids are accepted only when they equal a custom-field id in the
 * location snapshot. A display name, field key, or discovered id is not stored
 * in place of the submitted value. Workflows are not selected by name.
 */

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { SA360_ALL_LOGICAL_FIELD_KEYS } from "../lib/sa360-custom-field-keys.js";
import { isGhlDestinationConfigRequestEnabled } from "../lib/ghl-destination-config-request-env.js";
import { isPersistedLiveDestination } from "./ghl-destination-authorization.js";

export const GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A snapshot timestamp may lead this process by at most five minutes.
 * That covers ordinary clock skew between the database and the API.
 * A larger lead is rejected. An unparseable timestamp is rejected.
 */
export const GHL_DESTINATION_CONFIG_SNAPSHOT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type GhlDestinationSnapshotFreshness = "fresh" | "expired" | "future" | "malformed";

export function assessGhlDestinationSnapshotFreshness(
  fetchedAt: unknown,
  now: Date
): GhlDestinationSnapshotFreshness {
  const parsed = parseSnapshotTimestamp(fetchedAt);
  if (!parsed) return "malformed";
  if (now.getTime() - parsed.getTime() > GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS) return "expired";
  if (parsed.getTime() - now.getTime() > GHL_DESTINATION_CONFIG_SNAPSHOT_FUTURE_SKEW_MS) return "future";
  return "fresh";
}

function parseSnapshotTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export const GHL_DESTINATION_CONFIG_SURVEY_KEYS = [
  "desired_coverage",
  "branch_of_service",
  "primary_reason",
] as const;

const FIELD_KEYS = new Set<string>([
  ...GHL_DESTINATION_CONFIG_SURVEY_KEYS,
  ...SA360_ALL_LOGICAL_FIELD_KEYS,
]);

const TRANSACTION = { timeout: 10_000 } as const;

const BOUNDARY = {
  destinationUpdated: false as const,
  deliveryArmed: false as const,
  enrollmentPerformed: false as const,
  routingChanged: false as const,
  liveDestinationChanged: false as const,
};

export type GhlDestinationFieldMapping = {
  key: string;
  fieldId: string;
};

export type GhlDestinationConfigCommand = {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  expectedDestinationUpdatedAt: string | null;
  locationId: string;
  workflowId: string;
  fieldMappings: GhlDestinationFieldMapping[];
};

export type GhlDestinationConfigSuccess = {
  ok: true;
  requestId: string;
  revision: number;
  replayed: boolean;
  status: "stored";
  locationId: string;
  workflowId: string;
  fieldMappings: GhlDestinationFieldMapping[];
  snapshotFetchedAt: string;
} & typeof BOUNDARY;

export type GhlDestinationConfigFailure = {
  ok: false;
  statusCode: 400 | 404 | 409;
  error: string;
  replayed: false;
  requestId: string | null;
  revision: number | null;
} & typeof BOUNDARY;

export type GhlDestinationConfigResult = GhlDestinationConfigSuccess | GhlDestinationConfigFailure;

export type GhlDestinationConfigHead = {
  ok: true;
  clientAccountId: string;
  revision: number;
  destinationUpdatedAt: string | null;
  liveDestination: boolean;
  configuration: {
    requestId: string;
    revision: number;
    locationId: string;
    workflowId: string;
    fieldMappings: GhlDestinationFieldMapping[];
    snapshotFetchedAt: string;
    createdAt: string;
  } | null;
} & typeof BOUNDARY;

export type GhlDestinationConfigDeps = {
  now?: Date;
  /**
   * Test-only hook. It runs after the destination lock and before the live
   * re-read. Production routes do not pass it. A live result aborts the
   * transaction, so a mutation made here is rolled back with the save.
   */
  afterDestinationLock?: (tx: Prisma.TransactionClient, clientAccountId: string) => Promise<void>;
};

class ConfigRequestAbort extends Error {
  constructor(readonly result: GhlDestinationConfigFailure) {
    super(result.error);
  }
}

export async function readGhlDestinationConfigHead(
  db: PrismaClient,
  clientAccountId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<GhlDestinationConfigHead | GhlDestinationConfigFailure> {
  if (!isGhlDestinationConfigRequestEnabled(env)) return failure(404, "feature_disabled");
  const id = clientAccountId.trim();
  if (!id) return failure(404, "client_not_found");
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: { clientAccountId: true },
  });
  if (!client) return failure(404, "client_not_found");
  const [destination, open, max] = await Promise.all([
    db.clientGhlDestination.findUnique({ where: { clientAccountId: id } }),
    db.ghlDestinationConfigurationRequest.findFirst({
      where: { clientAccountId: id, status: "stored" },
    }),
    db.ghlDestinationConfigurationRequest.aggregate({
      where: { clientAccountId: id },
      _max: { revision: true },
    }),
  ]);
  return {
    ...BOUNDARY,
    ok: true,
    clientAccountId: id,
    revision: max._max.revision ?? 0,
    destinationUpdatedAt: destination?.updatedAt.toISOString() ?? null,
    liveDestination: isPersistedLiveDestination(destination, destination?.destinationSubaccountIdGhl),
    configuration: open
      ? {
          requestId: open.requestId,
          revision: open.revision,
          locationId: open.locationId,
          workflowId: open.workflowId,
          fieldMappings: mappingsFromJson(open.fieldMappingsJson),
          snapshotFetchedAt: open.snapshotFetchedAt.toISOString(),
          createdAt: open.createdAt.toISOString(),
        }
      : null,
  };
}

export async function recordGhlDestinationConfigRequest(
  db: PrismaClient,
  command: GhlDestinationConfigCommand,
  env: NodeJS.ProcessEnv = process.env,
  deps: GhlDestinationConfigDeps = {}
): Promise<GhlDestinationConfigResult> {
  if (!isGhlDestinationConfigRequestEnabled(env)) return failure(404, "feature_disabled");
  const clientAccountId = command.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found", command.requestId);
  const normalized = normalize(command, clientAccountId);
  const shape = validateShape(normalized);
  if (shape) return shape;
  try {
    return await db.$transaction(
      (tx) => applyCommand(tx, normalized, deps),
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
  command: GhlDestinationConfigCommand,
  deps: GhlDestinationConfigDeps
): Promise<GhlDestinationConfigSuccess> {
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
    FROM "ClientGhlDestination"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT "id"
    FROM "GhlDestinationConfigurationRequest"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;

  const replay = await replayCommand(tx, command);
  if (replay) return replay;

  const currentRevision = await headRevision(tx, command.clientAccountId);
  if (command.expectedRevision !== currentRevision) {
    abort(failure(409, "revision_conflict", command.requestId));
  }

  if (deps.afterDestinationLock) {
    await deps.afterDestinationLock(tx, command.clientAccountId);
  }

  const destination = await tx.clientGhlDestination.findUnique({
    where: { clientAccountId: command.clientAccountId },
  });
  if (isPersistedLiveDestination(destination, destination?.destinationSubaccountIdGhl)) {
    abort(failure(409, "live_destination", command.requestId));
  }
  if (!sameInstant(destination?.updatedAt ?? null, command.expectedDestinationUpdatedAt)) {
    abort(failure(409, "destination_stale", command.requestId));
  }

  const connection = await tx.ghlLocationConnection.findUnique({
    where: { locationId: command.locationId },
    select: { clientAccountId: true, connectionStatus: true },
  });
  if (!connection || connection.clientAccountId !== command.clientAccountId || connection.connectionStatus !== "connected") {
    abort(failure(409, "location_not_linked", command.requestId));
  }

  const snapshots = await tx.$queryRaw<Array<{
    id: string;
    fetchedAt: Date;
    workflowsJson: Prisma.JsonValue | null;
    customFieldsJson: Prisma.JsonValue | null;
  }>>`
    SELECT "id", "fetchedAt", "workflowsJson", "customFieldsJson"
    FROM "GhlLocationConfigSnapshot"
    WHERE "locationId" = ${command.locationId}
    ORDER BY "fetchedAt" DESC
    LIMIT 1
    FOR SHARE
  `;
  const snapshot = snapshots[0];
  if (!snapshot) abort(failure(409, "snapshot_missing", command.requestId));
  const now = deps.now ?? new Date();
  const freshness = assessGhlDestinationSnapshotFreshness(snapshot.fetchedAt, now);
  if (freshness === "malformed") abort(failure(409, "snapshot_unusable", command.requestId));
  if (freshness === "future") abort(failure(409, "snapshot_future", command.requestId));
  if (freshness !== "fresh") abort(failure(409, "snapshot_expired", command.requestId));
  const fetchedAt = parseSnapshotTimestamp(snapshot.fetchedAt);
  if (!fetchedAt) abort(failure(409, "snapshot_unusable", command.requestId));
  if (!workflowIds(snapshot.workflowsJson).has(command.workflowId)) {
    abort(failure(409, "workflow_not_in_snapshot", command.requestId));
  }
  const fieldIds = exactFieldIds(snapshot.customFieldsJson);
  for (const mapping of command.fieldMappings) {
    if (!fieldIds.has(mapping.fieldId)) abort(failure(409, "field_id_unverified", command.requestId));
  }
  const seen = new Set<string>();
  for (const mapping of command.fieldMappings) {
    if (seen.has(mapping.fieldId)) abort(failure(409, "duplicate_field_mapping", command.requestId));
    seen.add(mapping.fieldId);
  }

  const revision = currentRevision + 1;
  const open = await tx.ghlDestinationConfigurationRequest.findFirst({
    where: { clientAccountId: command.clientAccountId, status: "stored" },
  });
  const success: GhlDestinationConfigSuccess = {
    ...BOUNDARY,
    ok: true,
    requestId: command.requestId,
    revision,
    replayed: false,
    status: "stored",
    locationId: command.locationId,
    workflowId: command.workflowId,
    fieldMappings: command.fieldMappings,
    snapshotFetchedAt: fetchedAt.toISOString(),
  };
  if (open) {
    await tx.ghlDestinationConfigurationRequest.update({
      where: { id: open.id },
      data: {
        status: "superseded",
        supersededAt: now,
        supersededByRequestId: command.requestId,
      },
    });
  }
  await tx.ghlDestinationConfigurationRequest.create({
    data: {
      requestId: command.requestId,
      clientAccountId: command.clientAccountId,
      historicalClientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      revision,
      expectedDestinationUpdatedAt: command.expectedDestinationUpdatedAt
        ? new Date(command.expectedDestinationUpdatedAt)
        : null,
      locationId: command.locationId,
      workflowId: command.workflowId,
      fieldMappingsJson: command.fieldMappings,
      snapshotId: snapshot.id,
      snapshotFetchedAt: fetchedAt,
      status: "stored",
      payloadHash: commandHash(command),
      recordResultJson: success,
      actor: "ADMIN",
    },
  });
  return success;
}

async function replayCommand(
  tx: Prisma.TransactionClient,
  command: GhlDestinationConfigCommand
): Promise<GhlDestinationConfigSuccess | null> {
  const existing = await tx.ghlDestinationConfigurationRequest.findUnique({
    where: { requestId: command.requestId },
  });
  if (!existing) return null;
  if (existing.clientAccountId !== command.clientAccountId || existing.payloadHash !== commandHash(command)) {
    abort(failure(409, "request_id_reused", command.requestId));
  }
  const stored = existing.recordResultJson;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    abort(failure(409, "request_id_reused", command.requestId));
  }
  return { ...(stored as GhlDestinationConfigSuccess), replayed: true };
}

function normalize(
  command: GhlDestinationConfigCommand,
  clientAccountId: string
): GhlDestinationConfigCommand {
  return {
    ...command,
    clientAccountId,
    locationId: command.locationId.trim(),
    workflowId: command.workflowId.trim(),
    fieldMappings: [...command.fieldMappings]
      .map((mapping) => ({ key: mapping.key.trim(), fieldId: mapping.fieldId.trim() }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function validateShape(command: GhlDestinationConfigCommand): GhlDestinationConfigFailure | null {
  if (!command.locationId || !command.workflowId) return failure(400, "invalid_body", command.requestId);
  const keys = new Set<string>();
  for (const mapping of command.fieldMappings) {
    if (!FIELD_KEYS.has(mapping.key) || !mapping.fieldId) return failure(400, "invalid_field_key", command.requestId);
    if (keys.has(mapping.key)) return failure(400, "invalid_body", command.requestId);
    keys.add(mapping.key);
  }
  return null;
}

function commandHash(command: GhlDestinationConfigCommand): string {
  return createHash("sha256")
    .update(JSON.stringify({
      clientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      expectedDestinationUpdatedAt: command.expectedDestinationUpdatedAt,
      locationId: command.locationId,
      workflowId: command.workflowId,
      fieldMappings: command.fieldMappings,
    }))
    .digest("hex");
}

async function headRevision(tx: Prisma.TransactionClient, clientAccountId: string): Promise<number> {
  const max = await tx.ghlDestinationConfigurationRequest.aggregate({
    where: { clientAccountId },
    _max: { revision: true },
  });
  return max._max.revision ?? 0;
}

function workflowIds(json: Prisma.JsonValue | null): Set<string> {
  return stringField(json, "id");
}

function exactFieldIds(json: Prisma.JsonValue | null): Set<string> {
  return stringField(json, "id");
}

function stringField(json: Prisma.JsonValue | null, field: string): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(json)) return ids;
  for (const item of json) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = (item as Record<string, unknown>)[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids;
}

function mappingsFromJson(json: Prisma.JsonValue): GhlDestinationFieldMapping[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const key = (item as { key?: unknown }).key;
    const fieldId = (item as { fieldId?: unknown }).fieldId;
    if (typeof key !== "string" || typeof fieldId !== "string") return [];
    return [{ key, fieldId }];
  });
}

function sameInstant(left: Date | null, right: string | null): boolean {
  if (right === null) return left === null;
  if (left === null) return false;
  return left.getTime() === Date.parse(right);
}

function failure(
  statusCode: 400 | 404 | 409,
  error: string,
  requestId: string | null = null
): GhlDestinationConfigFailure {
  return { ...BOUNDARY, ok: false, statusCode, error, replayed: false, requestId, revision: null };
}

function abort(result: GhlDestinationConfigFailure): never {
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
