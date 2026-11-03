/**
 * Confirmed campaign DOB correction.
 *
 * Reuses `assessIncomingDobRecoveryRow` and
 * `normalizeLeadCaptureIoWebhookToLifecyclePayload`. A confirmed blank
 * canonical DOB or age is filled from the retained raw payload. A nonblank
 * disagreement is left in place. Other normalized keys, raw payload, status,
 * routing, delivery, inventory, and external destinations are not changed.
 *
 * The historical catalog projection trigger may refresh its read model when
 * `normalizedPayloadJson` changes. That trigger does not enqueue delivery.
 *
 * The durable audit is `IncomingDobCorrectionAudit`, inserted in the same
 * transaction as the payload update. Auth/Account owns that migration. Until
 * the table matches the documented schema, apply and rollback refuse and
 * write nothing. A table name alone is not enough. A local JSONL file may
 * supplement the table after commit. Rollback reads the table.
 *
 * Apply requires an explicit reviewed id list and expected count. It does
 * not scan the window and add rows.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from "node:fs";

import { Prisma, type PrismaClient } from "@prisma/client";

import { assertExpectedDbHost } from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import {
  assessIncomingDobRecoveryRow,
  readStoredSourceFunnelId,
  type IncomingDobRecoverySnapshot,
} from "./incoming-field-dob-recovery.js";

export const INCOMING_DOB_CORRECTION_VERSION = "incoming_field_dob_correction_v1" as const;
export const INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION = "APPLY CONFIRMED CAMPAIGN DOB CORRECTION";
export const INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION = "ROLLBACK CONFIRMED CAMPAIGN DOB CORRECTION";
export const INCOMING_DOB_CORRECTION_BATCH_SIZE = 25;
export const INCOMING_DOB_CORRECTION_AUDIT_SUFFIX = ".dob-correction-audit.jsonl";
export const INCOMING_DOB_CORRECTION_AUDIT_RELATION = "IncomingDobCorrectionAudit";
/** Prisma migrations belong to Auth/Account. This process does not create the table. */
export const INCOMING_DOB_CORRECTION_AUDIT_MIGRATION_OWNER = "Auth/Account";
export const INCOMING_DOB_CORRECTION_AUDIT_DDL = [
  `CREATE TABLE "IncomingDobCorrectionAudit" (
  id TEXT PRIMARY KEY,
  "version" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "previousUpdatedAt" TIMESTAMP(3) NOT NULL,
  "newUpdatedAt" TIMESTAMP(3) NOT NULL,
  "alreadyDelivered" BOOLEAN NOT NULL,
  "beforeJson" JSONB NOT NULL,
  "afterJson" JSONB NOT NULL,
  "externalDestinations" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX "IncomingDobCorrectionAudit_eventId_createdAt_idx" ON "IncomingDobCorrectionAudit" ("eventId", "createdAt")`,
  `ALTER TABLE "IncomingDobCorrectionAudit" ADD CONSTRAINT "IncomingDobCorrectionAudit_action_check" CHECK ("action" IN ('apply', 'rollback'))`,
] as const;

const DETAIL_KEYS = [
  "date_of_birth",
  "date_of_birth_provenance",
  "consumer_age",
  "consumer_age_provenance",
  "consumer_age_reference_date",
  "consumer_age_reference_rule",
] as const;

export type CanonicalDobAgeState = {
  date_of_birth: string | null;
  date_of_birth_provenance: string | null;
  consumer_age: string | null;
  consumer_age_provenance: string | null;
  consumer_age_reference_date: string | null;
  consumer_age_reference_rule: string | null;
  consumer_age_conflict: boolean | null;
  source_attribute_date_of_birth: string | null;
};

export type DobCorrectionPlan = {
  eventId: string;
  action: "apply" | "skip";
  reason: string;
  recoveryClass: string;
  alreadyDelivered: boolean;
  before: CanonicalDobAgeState;
  after: CanonicalDobAgeState;
};

export type DobCorrectionAudit = {
  version: typeof INCOMING_DOB_CORRECTION_VERSION;
  action: "apply" | "rollback";
  operator: string;
  eventId: string;
  previousUpdatedAt: string;
  newUpdatedAt: string;
  alreadyDelivered: boolean;
  before: CanonicalDobAgeState;
  after: CanonicalDobAgeState;
  externalDestinations: "unchanged";
};

type LockedEventRow = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceFunnelName: string | null;
  clientAccountIdResolved: string | null;
  status: string;
  receivedAt: Date;
  deliveredAt: Date | null;
  normalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rawPayloadJson: unknown;
  normalizedPayloadJson: unknown;
  enrichmentMetadataJson: unknown;
  routingResultJson: unknown;
};

type GuardFailure = { ok: false; reasonCode: string; reason: string };
type GuardSuccess = { ok: true; operator: string; limit: number; dbHostVerified: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function textOrNull(value: unknown): string | null {
  const text = cellText(value);
  return text || null;
}

export function readCanonicalDobAgeState(payload: unknown): CanonicalDobAgeState {
  const details = asRecord(asRecord(payload)?.lead_details) ?? {};
  const routing = asRecord(asRecord(payload)?.routing);
  const attributes = asRecord(asRecord(routing?.source_intake)?.sourceAttributes);
  const conflict = details.consumer_age_conflict;
  return {
    date_of_birth: textOrNull(details.date_of_birth),
    date_of_birth_provenance: textOrNull(details.date_of_birth_provenance),
    consumer_age: textOrNull(details.consumer_age),
    consumer_age_provenance: textOrNull(details.consumer_age_provenance),
    consumer_age_reference_date: textOrNull(details.consumer_age_reference_date),
    consumer_age_reference_rule: textOrNull(details.consumer_age_reference_rule),
    consumer_age_conflict: conflict === true || conflict === false ? conflict : null,
    source_attribute_date_of_birth: attributes ? textOrNull(attributes.date_of_birth) : null,
  };
}

const STATE_KEYS = [
  "date_of_birth",
  "date_of_birth_provenance",
  "consumer_age",
  "consumer_age_provenance",
  "consumer_age_reference_date",
  "consumer_age_reference_rule",
  "consumer_age_conflict",
  "source_attribute_date_of_birth",
] as const satisfies readonly (keyof CanonicalDobAgeState)[];

function statesEqual(left: CanonicalDobAgeState, right: CanonicalDobAgeState): boolean {
  return STATE_KEYS.every((key) => left[key] === right[key]);
}

function normalizeStoredState(value: Partial<CanonicalDobAgeState> | null | undefined): CanonicalDobAgeState {
  const conflict = value?.consumer_age_conflict;
  return {
    date_of_birth: value?.date_of_birth ?? null,
    date_of_birth_provenance: value?.date_of_birth_provenance ?? null,
    consumer_age: value?.consumer_age ?? null,
    consumer_age_provenance: value?.consumer_age_provenance ?? null,
    consumer_age_reference_date: value?.consumer_age_reference_date ?? null,
    consumer_age_reference_rule: value?.consumer_age_reference_rule ?? null,
    consumer_age_conflict: conflict === true || conflict === false ? conflict : null,
    source_attribute_date_of_birth: value?.source_attribute_date_of_birth ?? null,
  };
}

function proposedFromNormalizer(snapshot: IncomingDobRecoverySnapshot): {
  details: Record<string, unknown>;
  sourceAttributeDob: string | null;
} | null {
  const raw = asRecord(snapshot.rawPayload);
  if (!raw) return null;
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(structuredClone(raw), {
    sourceFunnelId: readStoredSourceFunnelId(snapshot) ?? undefined,
    receivedAt: snapshot.receivedAt,
    routeKeyFromPath: snapshot.sourceRouteKey ?? undefined,
  });
  const routing = asRecord(normalized.routing);
  const attributes = asRecord(asRecord(routing?.source_intake)?.sourceAttributes);
  return {
    details: asRecord(normalized.lead_details) ?? {},
    sourceAttributeDob: textOrNull(attributes?.date_of_birth),
  };
}

function fillBlankCanonical(
  payload: unknown,
  proposed: { details: Record<string, unknown>; sourceAttributeDob: string | null }
): unknown {
  const next = structuredClone(payload) as Record<string, unknown>;
  const details = { ...(asRecord(next.lead_details) ?? {}) };
  const canonicalDobWasBlank = !textOrNull(details.date_of_birth);
  for (const key of DETAIL_KEYS) {
    if (!textOrNull(details[key]) && textOrNull(proposed.details[key])) {
      details[key] = proposed.details[key];
    }
  }
  if (
    details.consumer_age_conflict == null &&
    (proposed.details.consumer_age_conflict === true || proposed.details.consumer_age_conflict === false)
  ) {
    details.consumer_age_conflict = proposed.details.consumer_age_conflict;
  }
  next.lead_details = details;

  const routing = asRecord(next.routing);
  const intake = asRecord(routing?.source_intake);
  const attributes = asRecord(intake?.sourceAttributes);
  if (
    canonicalDobWasBlank &&
    attributes &&
    !textOrNull(attributes.date_of_birth) &&
    proposed.sourceAttributeDob
  ) {
    attributes.date_of_birth = proposed.sourceAttributeDob;
  }
  return next;
}

export function planIncomingDobCorrection(
  snapshot: IncomingDobRecoverySnapshot,
  window: { receivedFrom: string; receivedTo: string | null }
): DobCorrectionPlan {
  const before = readCanonicalDobAgeState(snapshot.normalizedPayload);
  const assessed = assessIncomingDobRecoveryRow(snapshot, window);
  const base = {
    eventId: snapshot.id,
    recoveryClass: assessed.recoveryClass,
    alreadyDelivered: assessed.alreadyDelivered,
    before,
    after: before,
  };
  if (!assessed.inWindow) {
    return { ...base, action: "skip", reason: "outside_window" };
  }
  if (assessed.recoveryClass !== "eligible") {
    return { ...base, action: "skip", reason: assessed.reason };
  }
  if (!asRecord(snapshot.normalizedPayload)) {
    return { ...base, action: "skip", reason: "normalized_payload_missing" };
  }
  const conflict = asRecord(asRecord(snapshot.normalizedPayload)?.lead_details)?.consumer_age_conflict;
  if (conflict != null && conflict !== true && conflict !== false) {
    return { ...base, action: "skip", reason: "conflict_flag_unreadable" };
  }
  const proposed = proposedFromNormalizer(snapshot);
  if (!proposed || !textOrNull(proposed.details.date_of_birth)) {
    return { ...base, action: "skip", reason: "date_not_canonicalized" };
  }
  const next = fillBlankCanonical(snapshot.normalizedPayload, proposed);
  const after = readCanonicalDobAgeState(next);
  if (statesEqual(before, after)) {
    return { ...base, action: "skip", reason: "already_canonical" };
  }
  return { ...base, action: "apply", reason: assessed.reason, after };
}

export function restoreCanonicalDobAge(payload: unknown, state: CanonicalDobAgeState): unknown {
  const next = structuredClone(payload) as Record<string, unknown>;
  const details = { ...(asRecord(next.lead_details) ?? {}) };
  for (const key of DETAIL_KEYS) {
    const value = state[key];
    if (value == null) delete details[key];
    else details[key] = value;
  }
  if (state.consumer_age_conflict == null) delete details.consumer_age_conflict;
  else details.consumer_age_conflict = state.consumer_age_conflict;
  next.lead_details = details;

  const attributes = asRecord(asRecord(asRecord(next.routing)?.source_intake)?.sourceAttributes);
  if (attributes) {
    if (state.source_attribute_date_of_birth == null) delete attributes.date_of_birth;
    else attributes.date_of_birth = state.source_attribute_date_of_birth;
  }
  return next;
}

function chunk<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

export function guardIncomingDobCorrectionCommit(args: {
  databaseUrl: string;
  expectedDbHost: string;
  operator: string;
  confirm: string;
  confirmation: string;
  limit: number;
  auditFile: string;
}): GuardSuccess | GuardFailure {
  if (!args.databaseUrl.trim()) return { ok: false, reasonCode: "database_url_required", reason: "DATABASE_URL_required" };
  if (args.confirm.trim() !== args.confirmation) {
    return { ok: false, reasonCode: "confirmation_mismatch", reason: "confirmation_phrase_mismatch" };
  }
  const operator = args.operator.trim();
  if (!operator) return { ok: false, reasonCode: "operator_required", reason: "operator_required" };
  if (!Number.isInteger(args.limit) || args.limit < 1) {
    return { ok: false, reasonCode: "limit_required", reason: "positive_integer_limit_required" };
  }
  if (args.auditFile.trim() && !args.auditFile.endsWith(INCOMING_DOB_CORRECTION_AUDIT_SUFFIX)) {
    return { ok: false, reasonCode: "audit_file_required", reason: "audit_file_suffix_required" };
  }
  try {
    const identity = assertExpectedDbHost({
      databaseUrl: args.databaseUrl,
      expectedDbHost: args.expectedDbHost,
    });
    const dbHostVerified = identity.port ? `${identity.host}:${identity.port}` : identity.host;
    return { ok: true, operator, limit: args.limit, dbHostVerified };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "db_host_mismatch";
    return { ok: false, reasonCode: "db_host_mismatch", reason };
  }
}

export function appendDobCorrectionAudit(file: string, records: DobCorrectionAudit[]): void {
  if (records.length === 0) return;
  const fd = openSync(file, "a");
  try {
    for (const record of records) appendFileSync(fd, `${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readDobCorrectionAudits(file: string): DobCorrectionAudit[] {
  const text = readFileSync(file, "utf8");
  const records: DobCorrectionAudit[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as DobCorrectionAudit;
    if (parsed?.version !== INCOMING_DOB_CORRECTION_VERSION || !parsed.eventId) continue;
    records.push(parsed);
  }
  return records;
}

export type IncomingDobCorrectionAuditSchemaStatus = "missing" | "ready" | "incompatible";

const AUDIT_COLUMN_TYPES = [
  ["id", "text"],
  ["version", "text"],
  ["action", "text"],
  ["operator", "text"],
  ["eventId", "text"],
  ["previousUpdatedAt", "timestamp without time zone"],
  ["newUpdatedAt", "timestamp without time zone"],
  ["alreadyDelivered", "boolean"],
  ["beforeJson", "jsonb"],
  ["afterJson", "jsonb"],
  ["externalDestinations", "text"],
  ["createdAt", "timestamp without time zone"],
] as const;

/**
 * Name presence is not readiness. Apply and rollback require the documented
 * columns, nullability, primary key, event index, and action check.
 */
export async function incomingDobCorrectionAuditSchemaStatus(
  db: PrismaClient | Prisma.TransactionClient
): Promise<IncomingDobCorrectionAuditSchemaStatus> {
  const present = await db.$queryRaw<Array<{ present: string | null }>>(
    Prisma.sql`SELECT to_regclass('public."IncomingDobCorrectionAudit"')::text AS present`
  );
  if (present[0]?.present == null) return "missing";

  const columns = await db.$queryRaw<Array<{ column_name: string; data_type: string; is_nullable: string }>>(
    Prisma.sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'IncomingDobCorrectionAudit'
    `
  );
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  for (const [name, dataType] of AUDIT_COLUMN_TYPES) {
    const column = byName.get(name);
    if (!column || column.is_nullable !== "NO" || column.data_type !== dataType) return "incompatible";
  }

  const primary = await db.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public."IncomingDobCorrectionAudit"'::regclass
        AND contype = 'p'
    ) AS ok
  `);
  if (primary[0]?.ok !== true) return "incompatible";

  const indexes = await db.$queryRaw<Array<{ indexdef: string }>>(Prisma.sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'IncomingDobCorrectionAudit'
  `);
  if (!indexes.some((row) => row.indexdef.includes('"eventId"') && row.indexdef.includes('"createdAt"'))) {
    return "incompatible";
  }

  const checks = await db.$queryRaw<Array<{ def: string }>>(Prisma.sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public."IncomingDobCorrectionAudit"'::regclass
      AND contype = 'c'
  `);
  if (!checks.some((row) => row.def.includes("'apply'") && row.def.includes("'rollback'"))) return "incompatible";
  return "ready";
}

async function assertAuditSchemaInTransaction(tx: Prisma.TransactionClient): Promise<void> {
  const status = await incomingDobCorrectionAuditSchemaStatus(tx);
  if (status === "ready") return;
  throw new Error(status === "missing" ? "audit_relation_required" : "audit_relation_incompatible");
}

async function insertDobCorrectionAudit(
  tx: Prisma.TransactionClient,
  record: DobCorrectionAudit
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "IncomingDobCorrectionAudit" (
      id, "version", "action", "operator", "eventId",
      "previousUpdatedAt", "newUpdatedAt", "alreadyDelivered",
      "beforeJson", "afterJson", "externalDestinations", "createdAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
    randomUUID(),
    record.version,
    record.action,
    record.operator,
    record.eventId,
    new Date(record.previousUpdatedAt),
    new Date(record.newUpdatedAt),
    record.alreadyDelivered,
    JSON.stringify(record.before),
    JSON.stringify(record.after),
    record.externalDestinations,
    new Date()
  );
}

type StoredAuditRow = {
  version: string;
  action: string;
  operator: string;
  eventId: string;
  previousUpdatedAt: Date;
  newUpdatedAt: Date;
  alreadyDelivered: boolean;
  beforeJson: CanonicalDobAgeState;
  afterJson: CanonicalDobAgeState;
  externalDestinations: string;
};

export async function readDobCorrectionAuditsFromDb(
  db: PrismaClient | Prisma.TransactionClient
): Promise<DobCorrectionAudit[]> {
  const rows = await db.$queryRaw<StoredAuditRow[]>(Prisma.sql`
    SELECT
      "version",
      "action",
      "operator",
      "eventId",
      "previousUpdatedAt",
      "newUpdatedAt",
      "alreadyDelivered",
      "beforeJson",
      "afterJson",
      "externalDestinations"
    FROM "IncomingDobCorrectionAudit"
    ORDER BY "createdAt" ASC, id ASC
  `);
  const records: DobCorrectionAudit[] = [];
  for (const row of rows) {
    if (row.version !== INCOMING_DOB_CORRECTION_VERSION) continue;
    if (row.action !== "apply" && row.action !== "rollback") continue;
    if (row.externalDestinations !== "unchanged") continue;
    records.push({
      version: INCOMING_DOB_CORRECTION_VERSION,
      action: row.action,
      operator: row.operator,
      eventId: row.eventId,
      previousUpdatedAt: row.previousUpdatedAt.toISOString(),
      newUpdatedAt: row.newUpdatedAt.toISOString(),
      alreadyDelivered: row.alreadyDelivered,
      before: normalizeStoredState(row.beforeJson),
      after: normalizeStoredState(row.afterJson),
      externalDestinations: "unchanged",
    });
  }
  return records;
}

function expectedBeforeFor(
  expected: ReadonlyMap<string, CanonicalDobAgeState> | Record<string, CanonicalDobAgeState> | undefined,
  id: string
): CanonicalDobAgeState | undefined {
  if (!expected) return undefined;
  if (expected instanceof Map) return expected.get(id);
  const record = expected as Record<string, CanonicalDobAgeState>;
  return record[id];
}

/** Latest apply for each event that has not been rolled back. */
export function selectDobCorrectionRollbackTargets(records: DobCorrectionAudit[]): DobCorrectionAudit[] {
  const open = new Map<string, DobCorrectionAudit>();
  for (const record of records) {
    if (record.action === "apply") open.set(record.eventId, record);
    if (record.action === "rollback") open.delete(record.eventId);
  }
  return [...open.values()];
}

async function lockEvents(
  tx: Prisma.TransactionClient,
  ids: string[]
): Promise<LockedEventRow[]> {
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedEventRow[]>(Prisma.sql`
    SELECT
      id,
      "sourceProvider"::text AS "sourceProvider",
      "sourceSystem"::text AS "sourceSystem",
      "sourceRouteKey",
      "sourceFunnelName",
      "clientAccountIdResolved",
      status::text AS status,
      "receivedAt",
      "deliveredAt",
      "normalizedAt",
      "createdAt",
      "updatedAt",
      "rawPayloadJson",
      "normalizedPayloadJson",
      "enrichmentMetadataJson",
      "routingResultJson"
    FROM "SourceLeadEvent"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  `);
}

async function deliveryFlags(
  tx: Prisma.TransactionClient,
  ids: string[]
): Promise<{ sheets: Set<string>; ghl: Set<string>; allocated: Set<string> }> {
  const [sheets, ghl, allocations] = await Promise.all([
    tx.companySheetsDeliveryJob.findMany({
      where: { sourceLeadEventId: { in: ids } },
      select: { sourceLeadEventId: true, status: true, rowsWritten: true, appendStartedAt: true },
    }),
    tx.ghlAssociationDispatchOutbox.findMany({
      where: { sourceLeadEventId: { in: ids }, externalCallExecuted: true },
      select: { sourceLeadEventId: true },
    }),
    tx.leadAllocation.findMany({
      where: { sourceLeadEventId: { in: ids } },
      select: { sourceLeadEventId: true },
    }),
  ]);
  const sheetIds = new Set<string>();
  for (const job of sheets) {
    if (
      job.sourceLeadEventId &&
      (job.rowsWritten > 0 || job.appendStartedAt != null || job.status === "succeeded")
    ) {
      sheetIds.add(job.sourceLeadEventId);
    }
  }
  return {
    sheets: sheetIds,
    ghl: new Set(ghl.map((row) => row.sourceLeadEventId)),
    allocated: new Set(allocations.map((row) => row.sourceLeadEventId)),
  };
}

function snapshotFromRow(
  row: LockedEventRow,
  flags: { sheets: Set<string>; ghl: Set<string>; allocated: Set<string> }
): IncomingDobRecoverySnapshot {
  return {
    id: row.id,
    sourceProvider: row.sourceProvider,
    sourceSystem: row.sourceSystem,
    sourceRouteKey: row.sourceRouteKey,
    sourceFunnelName: row.sourceFunnelName,
    clientAccountId: row.clientAccountIdResolved,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    rawPayload: row.rawPayloadJson,
    normalizedPayload: row.normalizedPayloadJson,
    enrichment: row.enrichmentMetadataJson,
    routingResult: row.routingResultJson,
    sheetsDelivered: flags.sheets.has(row.id),
    ghlDelivered: flags.ghl.has(row.id),
    commerciallyAllocated: flags.allocated.has(row.id),
  };
}

export type DobCorrectionWriteResult = {
  version: typeof INCOMING_DOB_CORRECTION_VERSION;
  outcome: "APPLIED" | "ROLLED_BACK" | "REFUSED" | "NOOP" | "PENDING";
  ok: boolean;
  writesAttempted: boolean;
  complete: boolean;
  reasonCode?: string;
  reason?: string;
  dbHostVerified?: string;
  operator?: string;
  writtenIds: string[];
  pendingIds: string[];
  lockedIds: string[];
  skipped: Array<{ id: string; reason: string }>;
  counts: { requested: number; written: number; skipped: number; pending: number };
  auditExportFailed: boolean;
  auditRelation: typeof INCOMING_DOB_CORRECTION_AUDIT_RELATION;
  externalDestinations: "unchanged";
};

export function incomingDobCorrectionExitCode(result: DobCorrectionWriteResult): 0 | 2 | 3 {
  if (!result.ok) return 2;
  if (!result.complete) return 3;
  return 0;
}

function refusedResult(guard: GuardFailure): DobCorrectionWriteResult {
  return {
    version: INCOMING_DOB_CORRECTION_VERSION,
    outcome: "REFUSED",
    ok: false,
    writesAttempted: false,
    complete: false,
    reasonCode: guard.reasonCode,
    reason: guard.reason,
    writtenIds: [],
    pendingIds: [],
    lockedIds: [],
    skipped: [],
    counts: { requested: 0, written: 0, skipped: 0, pending: 0 },
    auditExportFailed: false,
    auditRelation: INCOMING_DOB_CORRECTION_AUDIT_RELATION,
    externalDestinations: "unchanged",
  };
}

function finishWriteResult(input: {
  kind: "apply" | "rollback";
  guard: GuardSuccess;
  requested: number;
  writtenIds: string[];
  pendingIds: string[];
  skipped: Array<{ id: string; reason: string }>;
  auditExportFailed: boolean;
}): DobCorrectionWriteResult {
  const counts = {
    requested: input.requested,
    written: input.writtenIds.length,
    skipped: input.skipped.length,
    pending: input.pendingIds.length,
  };
  const accounted = counts.written + counts.skipped + counts.pending === counts.requested;
  const complete = accounted && counts.pending === 0;
  const outcome = !complete
    ? "PENDING"
    : counts.written > 0
      ? input.kind === "apply"
        ? "APPLIED"
        : "ROLLED_BACK"
      : "NOOP";
  return {
    version: INCOMING_DOB_CORRECTION_VERSION,
    outcome,
    ok: true,
    writesAttempted: true,
    complete,
    dbHostVerified: input.guard.dbHostVerified,
    operator: input.guard.operator,
    writtenIds: input.writtenIds,
    pendingIds: input.pendingIds,
    lockedIds: input.pendingIds,
    skipped: input.skipped,
    counts,
    auditExportFailed: input.auditExportFailed,
    auditRelation: INCOMING_DOB_CORRECTION_AUDIT_RELATION,
    externalDestinations: "unchanged",
  };
}

function exportSupplementalAudit(file: string, records: DobCorrectionAudit[]): boolean {
  if (!file.trim() || records.length === 0) return false;
  try {
    appendDobCorrectionAudit(file, records);
    return false;
  } catch {
    return true;
  }
}

async function requireAuditRelation(db: PrismaClient): Promise<GuardFailure | null> {
  const status = await incomingDobCorrectionAuditSchemaStatus(db);
  if (status === "ready") return null;
  if (status === "missing") {
    return {
      ok: false,
      reasonCode: "audit_relation_required",
      reason: `${INCOMING_DOB_CORRECTION_AUDIT_RELATION}_missing`,
    };
  }
  return {
    ok: false,
    reasonCode: "audit_relation_incompatible",
    reason: `${INCOMING_DOB_CORRECTION_AUDIT_RELATION}_incompatible`,
  };
}

function reviewedCorrectionIds(
  ids: string[],
  expectedCount: number,
  limit: number
): { ok: true; ids: string[] } | GuardFailure {
  const trimmed = ids.map((id) => id.trim());
  const unique = [...new Set(trimmed)];
  if (
    !Number.isInteger(expectedCount) ||
    trimmed.some((id) => id.length === 0) ||
    trimmed.length !== unique.length ||
    expectedCount !== unique.length ||
    unique.length > limit
  ) {
    return { ok: false, reasonCode: "reviewed_count_mismatch", reason: "reviewed_count_mismatch" };
  }
  return { ok: true, ids: unique };
}

function timestampsUntouched(
  updated: { receivedAt: Date; normalizedAt: Date | null; createdAt: Date; deliveredAt: Date | null },
  row: LockedEventRow
): boolean {
  return (
    updated.receivedAt.getTime() === row.receivedAt.getTime() &&
    (updated.normalizedAt?.getTime() ?? null) === (row.normalizedAt?.getTime() ?? null) &&
    updated.createdAt.getTime() === row.createdAt.getTime() &&
    (updated.deliveredAt?.getTime() ?? null) === (row.deliveredAt?.getTime() ?? null)
  );
}

export async function applyIncomingDobCorrections(
  db: PrismaClient,
  args: {
    databaseUrl: string;
    expectedDbHost: string;
    operator: string;
    confirm: string;
    limit: number;
    auditFile: string;
    ids: string[];
    expectedCount: number;
    receivedFrom: string;
    receivedTo: string | null;
    expectedBeforeById?: ReadonlyMap<string, CanonicalDobAgeState> | Record<string, CanonicalDobAgeState>;
    beforeCommit?: () => Promise<void> | void;
  }
): Promise<DobCorrectionWriteResult> {
  const guard = guardIncomingDobCorrectionCommit({
    ...args,
    confirmation: INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION,
  });
  if (!guard.ok) return refusedResult(guard);
  const reviewed = reviewedCorrectionIds(args.ids, args.expectedCount, guard.limit);
  if (!reviewed.ok) return refusedResult(reviewed);
  const missingAudit = await requireAuditRelation(db);
  if (missingAudit) return refusedResult(missingAudit);

  const window = { receivedFrom: args.receivedFrom, receivedTo: args.receivedTo };
  const ids = reviewed.ids;
  const writtenIds: string[] = [];
  const pendingIds: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let auditExportFailed = false;

  for (const group of chunk(ids, INCOMING_DOB_CORRECTION_BATCH_SIZE)) {
    const committed = await db.$transaction(async (tx) => {
      await assertAuditSchemaInTransaction(tx);
      const audits: DobCorrectionAudit[] = [];
      const batchSkipped: Array<{ id: string; reason: string }> = [];
      const seen = new Set<string>();
      const locked = await lockEvents(tx, group);
      for (const row of locked) seen.add(row.id);
      const flags = await deliveryFlags(tx, locked.map((row) => row.id));
      for (const row of locked) {
        const current = readCanonicalDobAgeState(row.normalizedPayloadJson);
        const expected = expectedBeforeFor(args.expectedBeforeById, row.id);
        if (expected && !statesEqual(current, expected)) {
          batchSkipped.push({ id: row.id, reason: "changed_under_lock" });
          continue;
        }
        const snapshot = snapshotFromRow(row, flags);
        const plan = planIncomingDobCorrection(snapshot, window);
        if (plan.action !== "apply") {
          batchSkipped.push({ id: row.id, reason: plan.reason });
          continue;
        }
        const proposed = proposedFromNormalizer(snapshot);
        if (!proposed) {
          batchSkipped.push({ id: row.id, reason: "raw_payload_unreadable" });
          continue;
        }
        const next = fillBlankCanonical(row.normalizedPayloadJson, proposed);
        const updated = await tx.sourceLeadEvent.update({
          where: { id: row.id },
          data: { normalizedPayloadJson: next as Prisma.InputJsonValue },
          select: {
            updatedAt: true,
            receivedAt: true,
            normalizedAt: true,
            createdAt: true,
            deliveredAt: true,
          },
        });
        if (!timestampsUntouched(updated, row)) {
          throw new Error("correction_touched_unrelated_timestamp");
        }
        const audit: DobCorrectionAudit = {
          version: INCOMING_DOB_CORRECTION_VERSION,
          action: "apply",
          operator: guard.operator,
          eventId: row.id,
          previousUpdatedAt: row.updatedAt.toISOString(),
          newUpdatedAt: updated.updatedAt.toISOString(),
          alreadyDelivered: plan.alreadyDelivered,
          before: plan.before,
          after: plan.after,
          externalDestinations: "unchanged",
        };
        await insertDobCorrectionAudit(tx, audit);
        audits.push(audit);
      }
      if (args.beforeCommit) await args.beforeCommit();
      return { audits, batchSkipped, seen };
    });
    writtenIds.push(...committed.audits.map((audit) => audit.eventId));
    skipped.push(...committed.batchSkipped);
    for (const id of group) {
      if (!committed.seen.has(id)) pendingIds.push(id);
    }
    if (exportSupplementalAudit(args.auditFile, committed.audits)) auditExportFailed = true;
  }

  return finishWriteResult({
    kind: "apply",
    guard,
    requested: ids.length,
    writtenIds,
    pendingIds,
    skipped,
    auditExportFailed,
  });
}

export async function rollbackIncomingDobCorrections(
  db: PrismaClient,
  args: {
    databaseUrl: string;
    expectedDbHost: string;
    operator: string;
    confirm: string;
    limit: number;
    auditFile: string;
    beforeCommit?: () => Promise<void> | void;
  }
): Promise<DobCorrectionWriteResult> {
  const guard = guardIncomingDobCorrectionCommit({
    ...args,
    confirmation: INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
  });
  if (!guard.ok) return refusedResult(guard);
  const missingAudit = await requireAuditRelation(db);
  if (missingAudit) return refusedResult(missingAudit);

  const targets = selectDobCorrectionRollbackTargets(await readDobCorrectionAuditsFromDb(db)).slice(0, guard.limit);
  const writtenIds: string[] = [];
  const pendingIds: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let auditExportFailed = false;

  for (const group of chunk(targets, INCOMING_DOB_CORRECTION_BATCH_SIZE)) {
    const committed = await db.$transaction(async (tx) => {
      await assertAuditSchemaInTransaction(tx);
      const audits: DobCorrectionAudit[] = [];
      const batchSkipped: Array<{ id: string; reason: string }> = [];
      const seen = new Set<string>();
      const locked = await lockEvents(tx, group.map((target) => target.eventId));
      const byId = new Map(locked.map((row) => [row.id, row]));
      for (const target of group) {
        const row = byId.get(target.eventId);
        if (!row) continue;
        seen.add(row.id);
        const current = readCanonicalDobAgeState(row.normalizedPayloadJson);
        if (statesEqual(current, target.before)) {
          batchSkipped.push({ id: row.id, reason: "already_at_before" });
          continue;
        }
        if (!statesEqual(current, target.after)) {
          batchSkipped.push({ id: row.id, reason: "rollback_mismatch" });
          continue;
        }
        if (!asRecord(row.normalizedPayloadJson)) {
          batchSkipped.push({ id: row.id, reason: "normalized_payload_missing" });
          continue;
        }
        const next = restoreCanonicalDobAge(row.normalizedPayloadJson, target.before);
        const updated = await tx.sourceLeadEvent.update({
          where: { id: row.id },
          data: { normalizedPayloadJson: next as Prisma.InputJsonValue },
          select: { updatedAt: true, receivedAt: true, normalizedAt: true, createdAt: true, deliveredAt: true },
        });
        if (!timestampsUntouched(updated, row)) {
          throw new Error("rollback_touched_unrelated_timestamp");
        }
        const audit: DobCorrectionAudit = {
          version: INCOMING_DOB_CORRECTION_VERSION,
          action: "rollback",
          operator: guard.operator,
          eventId: row.id,
          previousUpdatedAt: row.updatedAt.toISOString(),
          newUpdatedAt: updated.updatedAt.toISOString(),
          alreadyDelivered: target.alreadyDelivered,
          before: target.after,
          after: target.before,
          externalDestinations: "unchanged",
        };
        await insertDobCorrectionAudit(tx, audit);
        audits.push(audit);
      }
      if (args.beforeCommit) await args.beforeCommit();
      return { audits, batchSkipped, seen };
    });
    writtenIds.push(...committed.audits.map((audit) => audit.eventId));
    skipped.push(...committed.batchSkipped);
    for (const target of group) {
      if (!committed.seen.has(target.eventId)) pendingIds.push(target.eventId);
    }
    if (exportSupplementalAudit(args.auditFile, committed.audits)) auditExportFailed = true;
  }

  return finishWriteResult({
    kind: "rollback",
    guard,
    requested: targets.length,
    writtenIds,
    pendingIds,
    skipped,
    auditExportFailed,
  });
}
