/**
 * Dry-run recovery assessment for the confirmed LeadCapture `date` birthday.
 *
 * This module only reads. It does not update rows, replay intake, change
 * inventory, routing, allocations, receipts, or timestamps, and it does not
 * enqueue delivery. The report omits raw dates, ages, names, and contact
 * values. A later update is described by `INCOMING_DOB_LATER_UPDATE_POLICY`
 * and is not implemented here.
 */

import type { PrismaClient } from "@prisma/client";

import { parseCampaignDateOfBirth } from "../consumer-age/campaign-dob-age.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import { normalizeLeadCaptureParentUrl } from "./leadcapture-parent-url.js";
import {
  CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID,
  matchScopedIncomingFieldBinding,
  normalizeSourceFieldKey,
} from "./source-field-alias.registry.js";

export const INCOMING_DOB_RECOVERY_REPORT_VERSION = "incoming_field_dob_recovery_v1" as const;

/** Confirmed source event from the veteran next-gen form. Assessed even outside the window. */
export const KNOWN_DOB_RECOVERY_EVENT_ID = "cmvzggvc00091ou0t9a644muo";

/**
 * Monday, October 26, 2026 00:00 in America/New_York (EDT, UTC-4).
 * The default window runs from this instant through the time of the read.
 */
export const INCOMING_DOB_RECOVERY_WINDOW_START = "2026-10-26T04:00:00.000Z";

export const INCOMING_DOB_RECOVERY_DEFAULT_LIMIT = 5_000;
export const INCOMING_DOB_RECOVERY_MAX_LIMIT = 20_000;

const CONFIRMED_BINDING_ID = "leadcapture_io_nextgen_vet_julia_dodge";

export const INCOMING_DOB_LATER_UPDATE_POLICY = {
  writes: false,
  implemented: false,
  concurrency:
    "Re-read confirmed eligible rows with SELECT … FOR UPDATE SKIP LOCKED, one small batch per transaction.",
  compareAndSet:
    "Recompute with this classifier. Write only when the class is still eligible and the stored lead_details date_of_birth and consumer_age still match the snapshot.",
  fields:
    "Merge only blank canonical date_of_birth, consumer_age, provenance, reference fields, and a visible consumer_age_conflict. Copy sourceAttributes.date_of_birth only when that canonical was blank. Leave every other normalized key untouched.",
  timestamps:
    'Set "updatedAt" = "updatedAt" in the same statement so Prisma @updatedAt does not move it. Do not change receivedAt, normalizedAt, createdAt, or deliveredAt.',
  untouched:
    "Do not change rawPayloadJson, status, routingResultJson, deliveryResultJson, inventory, allocations, delivery receipts, or any queue.",
  evidence:
    "Record before/after canonical fields in a separate operator audit. This dry-run report does not print those values.",
  idempotent:
    "A second run classifies the row unchanged once the stored canonical values equal the proposal, so the compare-and-set writes nothing.",
} as const;

export const INCOMING_DOB_UPSTREAM_PAYLOAD_CHANGE = {
  liveFormsChanged: false,
  form: "go.lifeinsuranceforvets.com/learn-julia-dodge",
  sourceFunnelId: CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID,
  birthdayField: "date_of_birth",
  submissionTimeField: "submitted_at",
  instruction:
    "Send the birthday as date_of_birth and the submission time as submitted_at. Do not put the birthday in date. Legacy forms keep date + time as the submission calendar.",
} as const;

export const INCOMING_DOB_RECOVERY_GAPS = [
  "No canonical field exists for occupation, coverage type, or beneficiary relationship. job_title, profession, coverage_type, type_of_coverage, insurance_type, beneficiary_relationship, and relationship_to_beneficiary stay unmapped.",
  "gender is not an alias of sex, and consent text is not a granted-consent flag.",
  "GHL discovery in sam-test-survey-text-fields.ts still treats a field named gender as the sex stamp target. This change does not edit that mapping.",
  "GHL custom-field stamp and the GHL note age line read sourceAttributes.age. Derived age stays on lead_details.consumer_age. Portal facts and the C.O.C. delivery detail fall back to that canonical age. A date-only form does not stamp GHL Age until delivery reads lead_details or the form sends age.",
  "A production count was not run. This command refuses remote database hosts.",
  "CamelCase answer keys now fingerprint as their underscored form. A route that previously snapshotted dateOfBirth as dateofbirth can show one schema-drift warning.",
] as const;

export type IncomingDobRecoveryClass =
  | "eligible"
  | "unchanged"
  | "conflicting"
  | "invalid"
  | "skipped";

export type IncomingDobRecoverySnapshot = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceFunnelName: string | null;
  clientAccountId: string | null;
  status: string;
  receivedAt: string;
  deliveredAt: string | null;
  rawPayload: unknown;
  normalizedPayload: unknown;
  enrichment: unknown;
  routingResult: unknown;
  sheetsDelivered: boolean;
  ghlDelivered: boolean;
  commerciallyAllocated: boolean;
};

export type IncomingDobRecoveryAssessment = {
  id: string;
  recoveryClass: IncomingDobRecoveryClass;
  reason: string;
  inWindow: boolean;
  dateMeansBirthday: boolean;
  alreadyDelivered: boolean;
  commerciallyAllocated: boolean;
  formKey: string;
  clientAccountId: string;
  sourceSystem: string;
  missingCanonicalDob: boolean;
  missingCanonicalAge: boolean;
  hasRawDate: boolean;
};

export type IncomingDobRecoveryCensusRow = {
  formKey: string;
  clientAccountId: string;
  sourceSystem: string;
  rows: number;
  missingCanonicalDob: number;
  missingCanonicalAge: number;
  dateMeansBirthday: boolean;
  alreadyDelivered: number;
};

export type IncomingDobRecoveryReport = {
  report: typeof INCOMING_DOB_RECOVERY_REPORT_VERSION;
  writes: false;
  truncated: boolean;
  window: {
    receivedFrom: string;
    receivedTo: string | null;
    timezone: "America/New_York";
  };
  knownEvent: {
    id: string;
    found: boolean;
    inWindow: boolean | null;
    recoveryClass: IncomingDobRecoveryClass | null;
    reason: string | null;
    dateMeansBirthday: boolean | null;
    alreadyDelivered: boolean | null;
    commerciallyAllocated: boolean | null;
    formKey: string | null;
    clientAccountId: string | null;
  };
  counts: {
    eligible: number;
    unchanged: number;
    conflicting: number;
    invalid: number;
    skipped: number;
    alreadyDelivered: number;
    alreadyDeliveredEligible: number;
  };
  reasons: Record<string, number>;
  census: IncomingDobRecoveryCensusRow[];
  confirmedBindingId: typeof CONFIRMED_BINDING_ID;
  laterUpdate: typeof INCOMING_DOB_LATER_UPDATE_POLICY;
  upstreamPayloadChange: typeof INCOMING_DOB_UPSTREAM_PAYLOAD_CHANGE;
  gaps: readonly string[];
};

type LeadDetails = {
  date_of_birth?: unknown;
  consumer_age?: unknown;
  consumer_age_conflict?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function leadDetailsOf(payload: unknown): LeadDetails {
  return (asRecord(asRecord(payload)?.lead_details) ?? {}) as LeadDetails;
}

function storedDob(payload: unknown): string {
  return cellText(leadDetailsOf(payload).date_of_birth);
}

function storedAge(payload: unknown): string {
  return cellText(leadDetailsOf(payload).consumer_age);
}

export function readStoredSourceFunnelId(snapshot: {
  enrichment: unknown;
  routingResult: unknown;
}): string | null {
  const enrichment = asRecord(snapshot.enrichment);
  const direct = cellText(enrichment?.sourceFunnelId);
  if (direct) return direct;
  const nested = cellText(asRecord(enrichment?.association)?.sourceFunnelId);
  if (nested) return nested;
  const routing = asRecord(snapshot.routingResult);
  return cellText(asRecord(routing?.sourceAssociation)?.sourceFunnelId) || null;
}

function parentUrlKey(raw: Record<string, unknown>): string | null {
  const answers = asRecord(raw.answers);
  const form = asRecord(raw.form);
  const value = raw.parent_url ?? answers?.parent_url ?? form?.parent_url;
  return normalizeLeadCaptureParentUrl(value)?.parentUrlKey ?? null;
}

function visibleDateLayers(raw: Record<string, unknown>, sourceSystem: string): Record<string, unknown>[] {
  const layers = [raw];
  const answers = asRecord(raw.answers);
  if (answers) layers.push(answers);
  if (sourceSystem !== "leadcapture_io_nextgen") {
    const form = asRecord(raw.form);
    if (form) layers.push(form);
  }
  return layers;
}

function dateValues(layers: Record<string, unknown>[]): string[] {
  const values: string[] = [];
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (normalizeSourceFieldKey(key) !== "date") continue;
      const text = cellText(value);
      if (text) values.push(text);
    }
  }
  return values;
}

function anyRawDate(raw: Record<string, unknown>): boolean {
  const layers = [raw, asRecord(raw.answers), asRecord(raw.form)].filter(
    (layer): layer is Record<string, unknown> => layer != null
  );
  return dateValues(layers).length > 0;
}

function formKeyFor(snapshot: IncomingDobRecoverySnapshot, raw: Record<string, unknown> | null): string {
  return (
    (raw ? parentUrlKey(raw) : null) ||
    snapshot.sourceRouteKey?.trim() ||
    snapshot.sourceFunnelName?.trim() ||
    "unknown_form"
  );
}

function inWindow(receivedAt: string, from: string, to: string | null): boolean {
  if (receivedAt < from) return false;
  if (to && receivedAt > to) return false;
  return true;
}

function proposedDetails(
  raw: Record<string, unknown>,
  snapshot: IncomingDobRecoverySnapshot,
  sourceFunnelId: string | null
): { dob: string; age: string; conflict: boolean; aliasConflict: boolean } {
  const copy = structuredClone(raw);
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(copy, {
    sourceFunnelId: sourceFunnelId ?? undefined,
    receivedAt: snapshot.receivedAt,
    routeKeyFromPath: snapshot.sourceRouteKey ?? undefined,
  });
  const details = leadDetailsOf(normalized);
  const intake = asRecord(asRecord(normalized.routing)?.source_intake);
  const aliasConflicts = Array.isArray(intake?.fieldAliasConflicts) ? intake.fieldAliasConflicts : [];
  const aliasConflict = aliasConflicts.some((conflict) => {
    const row = asRecord(conflict);
    const canonical = cellText(row?.canonical);
    return canonical === "date_of_birth" || canonical === "age";
  });
  return {
    dob: cellText(details.date_of_birth),
    age: cellText(details.consumer_age),
    conflict: details.consumer_age_conflict === true,
    aliasConflict,
  };
}

export function assessIncomingDobRecoveryRow(
  snapshot: IncomingDobRecoverySnapshot,
  window: { receivedFrom: string; receivedTo: string | null }
): IncomingDobRecoveryAssessment {
  const raw = asRecord(snapshot.rawPayload);
  const formKey = formKeyFor(snapshot, raw);
  const clientAccountId = snapshot.clientAccountId?.trim() || "unresolved_client";
  const base = {
    id: snapshot.id,
    inWindow: inWindow(snapshot.receivedAt, window.receivedFrom, window.receivedTo),
    alreadyDelivered:
      snapshot.deliveredAt != null ||
      snapshot.status === "delivered" ||
      snapshot.sheetsDelivered ||
      snapshot.ghlDelivered,
    commerciallyAllocated: snapshot.commerciallyAllocated,
    formKey,
    clientAccountId,
    sourceSystem: snapshot.sourceSystem,
    missingCanonicalDob: !storedDob(snapshot.normalizedPayload),
    missingCanonicalAge: !storedAge(snapshot.normalizedPayload),
    hasRawDate: raw ? anyRawDate(raw) : false,
  };

  const finish = (
    recoveryClass: IncomingDobRecoveryClass,
    reason: string,
    dateMeansBirthday: boolean
  ): IncomingDobRecoveryAssessment => ({
    ...base,
    recoveryClass,
    reason,
    dateMeansBirthday,
  });

  if (snapshot.sourceProvider !== "leadcapture_io") return finish("skipped", "not_leadcapture", false);
  if (!raw) return finish("skipped", "raw_payload_unreadable", false);

  const sourceFunnelId = readStoredSourceFunnelId(snapshot);
  const binding = matchScopedIncomingFieldBinding({
    provider: cellText(raw.provider) || cellText(raw.sa360_source_platform) || snapshot.sourceProvider,
    sourceSystem: cellText(raw.sa360_source_system) || snapshot.sourceSystem,
    sourceFunnelId,
    parentUrlKey: parentUrlKey(raw),
    sourceRouteKey: snapshot.sourceRouteKey,
  });
  const confirmed = binding?.id === CONFIRMED_BINDING_ID;
  if (!confirmed) return finish("skipped", "not_confirmed_form", false);

  const dates = [...new Set(dateValues(visibleDateLayers(raw, snapshot.sourceSystem)))];
  if (dates.length === 0) return finish("skipped", "no_raw_date", true);
  if (dates.length > 1) return finish("conflicting", "multiple_raw_dates", true);

  const parsed = parseCampaignDateOfBirth(dates[0]);
  const currentDob = storedDob(snapshot.normalizedPayload);
  const currentAge = storedAge(snapshot.normalizedPayload);
  if (!parsed) {
    return finish(currentDob ? "conflicting" : "invalid", currentDob ? "invalid_date_with_stored_dob" : "invalid_date", true);
  }

  const proposed = proposedDetails(raw, snapshot, sourceFunnelId);
  if (proposed.aliasConflict || proposed.conflict) return finish("conflicting", "alias_or_age_conflict", true);
  if (!proposed.dob) return finish("invalid", "date_not_canonicalized", true);
  if (currentDob && currentDob !== proposed.dob) return finish("conflicting", "stored_dob_differs", true);
  if (currentAge && proposed.age && currentAge !== proposed.age) {
    return finish("conflicting", "stored_age_differs", true);
  }
  if (currentAge && !proposed.age) return finish("conflicting", "stored_age_not_rederived", true);
  if (currentDob === proposed.dob && currentAge === proposed.age) return finish("unchanged", "already_canonical", true);
  return finish("eligible", currentDob ? "fill_blank_age" : "fill_blank_canonical", true);
}

function bump(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildIncomingDobRecoveryReport(input: {
  rows: IncomingDobRecoverySnapshot[];
  receivedFrom: string;
  receivedTo: string | null;
  knownEventId?: string;
  truncated?: boolean;
}): IncomingDobRecoveryReport {
  const knownEventId = input.knownEventId ?? KNOWN_DOB_RECOVERY_EVENT_ID;
  const window = { receivedFrom: input.receivedFrom, receivedTo: input.receivedTo };
  const assessments = input.rows.map((row) => assessIncomingDobRecoveryRow(row, window));
  const counted = assessments.filter((row) => row.inWindow);
  const counts = {
    eligible: 0,
    unchanged: 0,
    conflicting: 0,
    invalid: 0,
    skipped: 0,
    alreadyDelivered: 0,
    alreadyDeliveredEligible: 0,
  };
  const reasons: Record<string, number> = {};
  const census = new Map<string, IncomingDobRecoveryCensusRow>();

  for (const row of counted) {
    counts[row.recoveryClass] += 1;
    bump(reasons, `${row.recoveryClass}:${row.reason}`);
    if (row.alreadyDelivered) counts.alreadyDelivered += 1;
    if (row.alreadyDelivered && row.recoveryClass === "eligible") counts.alreadyDeliveredEligible += 1;
    if (!row.hasRawDate || (!row.missingCanonicalDob && !row.missingCanonicalAge)) continue;
    const key = `${row.sourceSystem}|${row.formKey}|${row.clientAccountId}`;
    const group = census.get(key) ?? {
      formKey: row.formKey,
      clientAccountId: row.clientAccountId,
      sourceSystem: row.sourceSystem,
      rows: 0,
      missingCanonicalDob: 0,
      missingCanonicalAge: 0,
      dateMeansBirthday: row.dateMeansBirthday,
      alreadyDelivered: 0,
    };
    group.rows += 1;
    if (row.missingCanonicalDob) group.missingCanonicalDob += 1;
    if (row.missingCanonicalAge) group.missingCanonicalAge += 1;
    if (row.alreadyDelivered) group.alreadyDelivered += 1;
    group.dateMeansBirthday = group.dateMeansBirthday || row.dateMeansBirthday;
    census.set(key, group);
  }

  const known = assessments.find((row) => row.id === knownEventId) ?? null;
  return {
    report: INCOMING_DOB_RECOVERY_REPORT_VERSION,
    writes: false,
    truncated: input.truncated === true,
    window: { ...window, timezone: "America/New_York" },
    knownEvent: {
      id: knownEventId,
      found: known != null,
      inWindow: known?.inWindow ?? null,
      recoveryClass: known?.recoveryClass ?? null,
      reason: known?.reason ?? null,
      dateMeansBirthday: known?.dateMeansBirthday ?? null,
      alreadyDelivered: known?.alreadyDelivered ?? null,
      commerciallyAllocated: known?.commerciallyAllocated ?? null,
      formKey: known?.formKey ?? null,
      clientAccountId: known?.clientAccountId ?? null,
    },
    counts,
    reasons,
    census: [...census.values()].sort((a, b) =>
      `${a.sourceSystem}|${a.formKey}|${a.clientAccountId}`.localeCompare(
        `${b.sourceSystem}|${b.formKey}|${b.clientAccountId}`
      )
    ),
    confirmedBindingId: CONFIRMED_BINDING_ID,
    laterUpdate: INCOMING_DOB_LATER_UPDATE_POLICY,
    upstreamPayloadChange: INCOMING_DOB_UPSTREAM_PAYLOAD_CHANGE,
    gaps: INCOMING_DOB_RECOVERY_GAPS,
  };
}

type EventRow = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceFunnelName: string | null;
  clientAccountIdResolved: string | null;
  status: string;
  receivedAt: Date;
  deliveredAt: Date | null;
  rawPayloadJson: unknown;
  normalizedPayloadJson: unknown;
  enrichmentMetadataJson: unknown;
  routingResultJson: unknown;
};

function chunk<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

export async function readIncomingDobRecoverySnapshots(
  db: PrismaClient,
  query: {
    receivedFrom: Date;
    receivedTo: Date | null;
    knownEventId: string;
    limit: number;
  }
): Promise<{ rows: IncomingDobRecoverySnapshot[]; truncated: boolean }> {
  const receivedAt: { gte: Date; lte?: Date } = { gte: query.receivedFrom };
  if (query.receivedTo) receivedAt.lte = query.receivedTo;
  const events = (await db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: "leadcapture_io",
      OR: [{ receivedAt }, { id: query.knownEventId }],
    },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      sourceProvider: true,
      sourceSystem: true,
      sourceRouteKey: true,
      sourceFunnelName: true,
      clientAccountIdResolved: true,
      status: true,
      receivedAt: true,
      deliveredAt: true,
      rawPayloadJson: true,
      normalizedPayloadJson: true,
      enrichmentMetadataJson: true,
      routingResultJson: true,
    },
  })) as EventRow[];
  const truncated = events.length > query.limit;
  const page = truncated ? events.slice(0, query.limit) : events;
  const ids = page.map((event) => event.id);
  const sheetsDelivered = new Set<string>();
  const ghlDelivered = new Set<string>();
  const allocated = new Set<string>();

  for (const group of chunk(ids, 200)) {
    const [sheets, ghl, allocations] = await Promise.all([
      db.companySheetsDeliveryJob.findMany({
        where: { sourceLeadEventId: { in: group } },
        select: { sourceLeadEventId: true, status: true, rowsWritten: true, appendStartedAt: true },
      }),
      db.ghlAssociationDispatchOutbox.findMany({
        where: { sourceLeadEventId: { in: group }, externalCallExecuted: true },
        select: { sourceLeadEventId: true },
      }),
      db.leadAllocation.findMany({
        where: { sourceLeadEventId: { in: group } },
        select: { sourceLeadEventId: true },
      }),
    ]);
    for (const job of sheets) {
      if (
        job.sourceLeadEventId &&
        (job.rowsWritten > 0 || job.appendStartedAt != null || job.status === "succeeded")
      ) {
        sheetsDelivered.add(job.sourceLeadEventId);
      }
    }
    for (const row of ghl) ghlDelivered.add(row.sourceLeadEventId);
    for (const row of allocations) allocated.add(row.sourceLeadEventId);
  }

  return {
    truncated,
    rows: page.map((event) => ({
      id: event.id,
      sourceProvider: event.sourceProvider,
      sourceSystem: event.sourceSystem,
      sourceRouteKey: event.sourceRouteKey,
      sourceFunnelName: event.sourceFunnelName,
      clientAccountId: event.clientAccountIdResolved,
      status: event.status,
      receivedAt: event.receivedAt.toISOString(),
      deliveredAt: event.deliveredAt?.toISOString() ?? null,
      rawPayload: event.rawPayloadJson,
      normalizedPayload: event.normalizedPayloadJson,
      enrichment: event.enrichmentMetadataJson,
      routingResult: event.routingResultJson,
      sheetsDelivered: sheetsDelivered.has(event.id),
      ghlDelivered: ghlDelivered.has(event.id),
      commerciallyAllocated: allocated.has(event.id),
    })),
  };
}
