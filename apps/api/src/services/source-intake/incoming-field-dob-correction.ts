/**
 * Confirmed Julia Dodge DOB correction.
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
 * There is no audit table. Each committed change appends one JSONL line.
 */

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
export const INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION = "APPLY CONFIRMED JULIA DOB CORRECTION";
export const INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION = "ROLLBACK CONFIRMED JULIA DOB CORRECTION";
export const INCOMING_DOB_CORRECTION_BATCH_SIZE = 25;
export const INCOMING_DOB_CORRECTION_AUDIT_SUFFIX = ".dob-correction-audit.jsonl";

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

function statesEqual(left: CanonicalDobAgeState, right: CanonicalDobAgeState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  if (!args.auditFile.endsWith(INCOMING_DOB_CORRECTION_AUDIT_SUFFIX)) {
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
  outcome: "APPLIED" | "ROLLED_BACK" | "REFUSED" | "NOOP";
  ok: boolean;
  writesAttempted: boolean;
  reasonCode?: string;
  reason?: string;
  dbHostVerified?: string;
  operator?: string;
  writtenIds: string[];
  lockedIds: string[];
  skipped: Array<{ id: string; reason: string }>;
  externalDestinations: "unchanged";
};

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
    receivedFrom: string;
    receivedTo: string | null;
  }
): Promise<DobCorrectionWriteResult> {
  const guard = guardIncomingDobCorrectionCommit({
    ...args,
    confirmation: INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION,
  });
  if (!guard.ok) {
    return {
      version: INCOMING_DOB_CORRECTION_VERSION,
      outcome: "REFUSED",
      ok: false,
      writesAttempted: false,
      reasonCode: guard.reasonCode,
      reason: guard.reason,
      writtenIds: [],
      lockedIds: [],
      skipped: [],
      externalDestinations: "unchanged",
    };
  }

  const window = { receivedFrom: args.receivedFrom, receivedTo: args.receivedTo };
  const ids = [...new Set(args.ids)].slice(0, guard.limit);
  const writtenIds: string[] = [];
  const lockedIds: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const group of chunk(ids, INCOMING_DOB_CORRECTION_BATCH_SIZE)) {
    const audits: DobCorrectionAudit[] = [];
    const seen = new Set<string>();
    await db.$transaction(async (tx) => {
      const locked = await lockEvents(tx, group);
      for (const row of locked) seen.add(row.id);
      const flags = await deliveryFlags(tx, locked.map((row) => row.id));
      for (const row of locked) {
        const snapshot = snapshotFromRow(row, flags);
        const plan = planIncomingDobCorrection(snapshot, window);
        if (plan.action !== "apply") {
          skipped.push({ id: row.id, reason: plan.reason });
          continue;
        }
        const proposed = proposedFromNormalizer(snapshot);
        if (!proposed) {
          skipped.push({ id: row.id, reason: "raw_payload_unreadable" });
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
        if (
          updated.receivedAt.getTime() !== row.receivedAt.getTime() ||
          (updated.normalizedAt?.getTime() ?? null) !== (row.normalizedAt?.getTime() ?? null) ||
          updated.createdAt.getTime() !== row.createdAt.getTime() ||
          (updated.deliveredAt?.getTime() ?? null) !== (row.deliveredAt?.getTime() ?? null)
        ) {
          throw new Error("correction_touched_unrelated_timestamp");
        }
        writtenIds.push(row.id);
        audits.push({
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
        });
      }
    });
    for (const id of group) {
      if (!seen.has(id)) lockedIds.push(id);
    }
    appendDobCorrectionAudit(args.auditFile, audits);
  }

  return {
    version: INCOMING_DOB_CORRECTION_VERSION,
    outcome: writtenIds.length > 0 ? "APPLIED" : "NOOP",
    ok: true,
    writesAttempted: true,
    dbHostVerified: guard.dbHostVerified,
    operator: guard.operator,
    writtenIds,
    lockedIds,
    skipped,
    externalDestinations: "unchanged",
  };
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
  }
): Promise<DobCorrectionWriteResult> {
  const guard = guardIncomingDobCorrectionCommit({
    ...args,
    confirmation: INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
  });
  if (!guard.ok) {
    return {
      version: INCOMING_DOB_CORRECTION_VERSION,
      outcome: "REFUSED",
      ok: false,
      writesAttempted: false,
      reasonCode: guard.reasonCode,
      reason: guard.reason,
      writtenIds: [],
      lockedIds: [],
      skipped: [],
      externalDestinations: "unchanged",
    };
  }

  const targets = selectDobCorrectionRollbackTargets(readDobCorrectionAudits(args.auditFile)).slice(0, guard.limit);
  const writtenIds: string[] = [];
  const lockedIds: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const group of chunk(targets, INCOMING_DOB_CORRECTION_BATCH_SIZE)) {
    const audits: DobCorrectionAudit[] = [];
    const seen = new Set<string>();
    await db.$transaction(async (tx) => {
      const locked = await lockEvents(tx, group.map((target) => target.eventId));
      const byId = new Map(locked.map((row) => [row.id, row]));
      for (const target of group) {
        const row = byId.get(target.eventId);
        if (!row) continue;
        seen.add(row.id);
        const current = readCanonicalDobAgeState(row.normalizedPayloadJson);
        if (statesEqual(current, target.before)) {
          skipped.push({ id: row.id, reason: "already_at_before" });
          continue;
        }
        if (!statesEqual(current, target.after)) {
          skipped.push({ id: row.id, reason: "rollback_mismatch" });
          continue;
        }
        if (!asRecord(row.normalizedPayloadJson)) {
          skipped.push({ id: row.id, reason: "normalized_payload_missing" });
          continue;
        }
        const next = restoreCanonicalDobAge(row.normalizedPayloadJson, target.before);
        const updated = await tx.sourceLeadEvent.update({
          where: { id: row.id },
          data: { normalizedPayloadJson: next as Prisma.InputJsonValue },
          select: { updatedAt: true, receivedAt: true, normalizedAt: true, createdAt: true, deliveredAt: true },
        });
        if (
          updated.receivedAt.getTime() !== row.receivedAt.getTime() ||
          (updated.normalizedAt?.getTime() ?? null) !== (row.normalizedAt?.getTime() ?? null) ||
          updated.createdAt.getTime() !== row.createdAt.getTime() ||
          (updated.deliveredAt?.getTime() ?? null) !== (row.deliveredAt?.getTime() ?? null)
        ) {
          throw new Error("rollback_touched_unrelated_timestamp");
        }
        writtenIds.push(row.id);
        audits.push({
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
        });
      }
    });
    for (const target of group) {
      if (!seen.has(target.eventId)) lockedIds.push(target.eventId);
    }
    appendDobCorrectionAudit(args.auditFile, audits);
  }

  return {
    version: INCOMING_DOB_CORRECTION_VERSION,
    outcome: writtenIds.length > 0 ? "ROLLED_BACK" : "NOOP",
    ok: true,
    writesAttempted: true,
    dbHostVerified: guard.dbHostVerified,
    operator: guard.operator,
    writtenIds,
    lockedIds,
    skipped,
    externalDestinations: "unchanged",
  };
}
