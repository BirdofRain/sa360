/**
 * Dedicated historical Master enrichment backfill.
 * UPDATE-ONLY on existing SourceLeadEvent JSON. Never creates inventory or events.
 * Normal import commit/resume semantics are unchanged.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma, PrismaClient } from "@prisma/client";
import { AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE, AGED_INVENTORY_BULK_MAX_BATCH_SIZE } from "@sa360/shared";

import {
  isInvalidConsumerAgeStatus,
  type ConsumerAgeParseStatus,
} from "./aged-inventory-bulk-consumer-age.js";
import {
  adaptMasterRow,
  assertMasterHeaders,
  resolveDefaultNiche,
} from "./aged-inventory-bulk-adapters.js";
import { assertExpectedDbHost } from "./aged-inventory-bulk-db-guard.js";
import {
  buildAgedBulkNormalizedPayload,
  createIdentityConflictIndex,
  mergeAgedBulkRawPayload,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import { assertFileSha256, streamCsvFile } from "./aged-inventory-bulk-stream.js";
import {
  AGED_INVENTORY_BULK_ENRICH_COMMIT_CONFIRMATION,
  type AgedBulkCliArgs,
  type AgedBulkNormalizedRow,
  type AgedBulkSourceFormat,
} from "./aged-inventory-bulk.types.js";

/** Hard invariant: backfill never proposes inventory creates. */
export const PROPOSED_LEAD_INVENTORY_ITEM_CREATES = 0 as const;

export const ENRICH_CHECKPOINT_VERSION = "aged-bulk-enrich-checkpoint-v1" as const;

const FROZEN_IDENTITY_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone_e164",
  "state",
  "generated_at",
  "niche_key",
  "status_raw",
  "used_by_present",
  "email_issue",
] as const;

export const ENRICHMENT_COVERAGE_FIELDS = {
  common: ["zip", "consumer_age", "beneficiary", "campaign_name"] as const,
  vet: ["branch_of_service", "disability_rating", "primary_concern"] as const,
  trucker: ["company_or_independent", "rig_type"] as const,
};

export type EnrichmentCoverageField =
  | (typeof ENRICHMENT_COVERAGE_FIELDS.common)[number]
  | (typeof ENRICHMENT_COVERAGE_FIELDS.vet)[number]
  | (typeof ENRICHMENT_COVERAGE_FIELDS.trucker)[number];

export type CoverageCounts = Record<string, { populated: number; total: number }>;

export type EnrichmentMergeResult = {
  merged: Record<string, unknown>;
  conflictFields: string[];
  filledFields: string[];
  changed: boolean;
};

export type SourceLeadMatchKind = "unmatched_source_lead_id" | "exact" | "ambiguous_source_lead_id";

export type AgedBulkEnrichmentReport = {
  mode: "enrich-preview" | "enrich-commit";
  sourceRows: number;
  parsedRows: number;
  exactExistingMatches: number;
  rowsNeedingEnrichment: number;
  rowsAlreadyEquivalent: number;
  unmatchedRows: number;
  ambiguousRows: number;
  fieldConflictRows: number;
  invalidConsumerAgeRows: number;
  fileDuplicateSourceLeadIdRows: number;
  coverageBefore: CoverageCounts;
  coverageAfter: CoverageCounts;
  proposedSourceLeadEventUpdates: number;
  proposedLeadInventoryItemCreates: typeof PROPOSED_LEAD_INVENTORY_ITEM_CREATES;
  actualLeadInventoryItemCreates: typeof PROPOSED_LEAD_INVENTORY_ITEM_CREATES;
  appliedSourceLeadEventUpdates: number;
};

type ExistingEventRow = {
  id: string;
  sourceLeadId: string | null;
  normalizedPayloadJson: unknown;
  rawPayloadJson: unknown;
  enrichmentMetadataJson: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isEmptyEnrichmentValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return false;
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function enrichmentValuesEqual(existing: unknown, incoming: unknown): boolean {
  if (existing == null && incoming == null) return true;
  if (typeof existing === "number" && typeof incoming === "number") return existing === incoming;
  if (typeof existing === "number" && typeof incoming === "string") {
    return String(existing) === incoming.trim();
  }
  if (typeof existing === "string" && typeof incoming === "number") {
    return existing.trim() === String(incoming);
  }
  if (typeof existing === "string" && typeof incoming === "string") {
    return existing.trim() === incoming.trim();
  }
  return existing === incoming;
}

function mergeEnrichmentField(
  existing: unknown,
  incoming: unknown,
  fieldPath: string,
  result: Pick<EnrichmentMergeResult, "conflictFields" | "filledFields">
): unknown {
  if (isEmptyEnrichmentValue(existing)) {
    if (isEmptyEnrichmentValue(incoming)) return existing ?? incoming ?? null;
    result.filledFields.push(fieldPath);
    return incoming;
  }
  if (isEmptyEnrichmentValue(incoming)) return existing;
  if (enrichmentValuesEqual(existing, incoming)) return existing;
  result.conflictFields.push(fieldPath);
  return existing;
}

function readCoverageValue(payload: unknown, field: EnrichmentCoverageField): unknown {
  const root = asRecord(payload);
  if (!root) return null;
  if (field === "campaign_name") return root.campaign_name;
  const contact = asRecord(root.contact);
  if (field === "zip") return contact?.zip;
  const details = asRecord(root.lead_details);
  if (field === "consumer_age") return details?.consumer_age;
  if (field === "beneficiary") return details?.beneficiary;
  const niche = asRecord(details?.niche);
  return niche?.[field];
}

export function emptyCoverageCounts(sourceFormat: AgedBulkSourceFormat): CoverageCounts {
  const fields: EnrichmentCoverageField[] = [
    ...ENRICHMENT_COVERAGE_FIELDS.common,
    ...(sourceFormat === "vet_master_v1"
      ? ENRICHMENT_COVERAGE_FIELDS.vet
      : ENRICHMENT_COVERAGE_FIELDS.trucker),
  ];
  return Object.fromEntries(fields.map((field) => [field, { populated: 0, total: 0 }]));
}

export function addCoverageSample(
  coverage: CoverageCounts,
  payload: unknown,
  fields: readonly EnrichmentCoverageField[]
) {
  for (const field of fields) {
    const bucket = coverage[field];
    if (!bucket) continue;
    bucket.total += 1;
    if (!isEmptyEnrichmentValue(readCoverageValue(payload, field))) {
      bucket.populated += 1;
    }
  }
}

export function coverageFieldsFor(sourceFormat: AgedBulkSourceFormat): EnrichmentCoverageField[] {
  return [
    ...ENRICHMENT_COVERAGE_FIELDS.common,
    ...(sourceFormat === "vet_master_v1"
      ? ENRICHMENT_COVERAGE_FIELDS.vet
      : ENRICHMENT_COVERAGE_FIELDS.trucker),
  ];
}

/**
 * Preserve existing normalized content. Fill empty enrichment fields from Master.
 * Conflicting non-empty values are reported and left unchanged.
 * Flat identity + generated_at are copied from existing exactly.
 */
export function mergeNormalizedPayloadForEnrichment(
  existingPayload: unknown,
  incomingPayload: Record<string, unknown>
): EnrichmentMergeResult {
  const existing = asRecord(existingPayload) ?? {};
  const incoming = incomingPayload;
  const conflictFields: string[] = [];
  const filledFields: string[] = [];
  const track = { conflictFields, filledFields };

  const merged: Record<string, unknown> = { ...existing };

  for (const key of FROZEN_IDENTITY_KEYS) {
    if (key in existing) merged[key] = existing[key];
  }

  merged.campaign_name = mergeEnrichmentField(
    existing.campaign_name,
    incoming.campaign_name,
    "campaign_name",
    track
  );

  const existingContact = asRecord(existing.contact) ?? {};
  const incomingContact = asRecord(incoming.contact) ?? {};
  merged.contact = {
    ...existingContact,
    first_name: "first_name" in existingContact ? existingContact.first_name : existing.firstName,
    last_name: "last_name" in existingContact ? existingContact.last_name : existing.lastName,
    phone_e164: "phone_e164" in existingContact ? existingContact.phone_e164 : existing.phone_e164,
    email: "email" in existingContact ? existingContact.email : existing.email,
    state: "state" in existingContact ? existingContact.state : existing.state,
    zip: mergeEnrichmentField(existingContact.zip, incomingContact.zip, "contact.zip", track),
  };

  const existingDetails = asRecord(existing.lead_details) ?? {};
  const incomingDetails = asRecord(incoming.lead_details) ?? {};
  const existingNiche = asRecord(existingDetails.niche) ?? {};
  const incomingNiche = asRecord(incomingDetails.niche) ?? {};
  const niche: Record<string, unknown> = { ...existingNiche };
  for (const [key, value] of Object.entries(incomingNiche)) {
    niche[key] = mergeEnrichmentField(existingNiche[key], value, `lead_details.niche.${key}`, track);
  }

  merged.lead_details = {
    ...existingDetails,
    consumer_age: mergeEnrichmentField(
      existingDetails.consumer_age,
      incomingDetails.consumer_age,
      "lead_details.consumer_age",
      track
    ),
    date_of_birth: mergeEnrichmentField(
      existingDetails.date_of_birth,
      incomingDetails.date_of_birth,
      "lead_details.date_of_birth",
      track
    ),
    beneficiary: mergeEnrichmentField(
      existingDetails.beneficiary,
      incomingDetails.beneficiary,
      "lead_details.beneficiary",
      track
    ),
    niche,
  };

  const changed =
    filledFields.length > 0 ||
    JSON.stringify(merged.contact) !== JSON.stringify(existing.contact ?? null) ||
    JSON.stringify(merged.lead_details) !== JSON.stringify(existing.lead_details ?? null) ||
    !("campaign_name" in existing && enrichmentValuesEqual(existing.campaign_name, merged.campaign_name));

  return { merged, conflictFields, filledFields, changed };
}

export function mergeEnrichmentMetadata(
  existing: unknown,
  input: {
    operator: string;
    sourceFormat: AgedBulkSourceFormat;
    fileSha256Prefix: string;
    consumerAgeParseStatus: string;
    evaluatedAtIso: string;
  }
): Record<string, unknown> {
  const prior = asRecord(existing) ?? {};
  return {
    ...prior,
    historicalEnrichment: {
      kind: "aged_master_enrichment_v1",
      operator: input.operator,
      sourceFormat: input.sourceFormat,
      fileSha256Prefix: input.fileSha256Prefix,
      consumerAgeParseStatus: input.consumerAgeParseStatus,
      evaluatedAtIso: input.evaluatedAtIso,
    },
  };
}

export function classifySourceLeadIdMatch(events: ExistingEventRow[]): SourceLeadMatchKind {
  if (events.length === 0) return "unmatched_source_lead_id";
  if (events.length === 1) return "exact";
  return "ambiguous_source_lead_id";
}

function emptyReport(mode: AgedBulkEnrichmentReport["mode"], sourceFormat: AgedBulkSourceFormat): AgedBulkEnrichmentReport {
  return {
    mode,
    sourceRows: 0,
    parsedRows: 0,
    exactExistingMatches: 0,
    rowsNeedingEnrichment: 0,
    rowsAlreadyEquivalent: 0,
    unmatchedRows: 0,
    ambiguousRows: 0,
    fieldConflictRows: 0,
    invalidConsumerAgeRows: 0,
    fileDuplicateSourceLeadIdRows: 0,
    coverageBefore: emptyCoverageCounts(sourceFormat),
    coverageAfter: emptyCoverageCounts(sourceFormat),
    proposedSourceLeadEventUpdates: 0,
    proposedLeadInventoryItemCreates: PROPOSED_LEAD_INVENTORY_ITEM_CREATES,
    actualLeadInventoryItemCreates: PROPOSED_LEAD_INVENTORY_ITEM_CREATES,
    appliedSourceLeadEventUpdates: 0,
  };
}

function progressLog(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...data }));
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function enrichCheckpointPath(workDir: string, fileSha256: string): string {
  return path.join(workDir, `enrich-checkpoint-${fileSha256.slice(0, 12)}.json`);
}

type EnrichCheckpoint = {
  version: typeof ENRICH_CHECKPOINT_VERSION;
  fileSha256: string;
  sourceFormat: string;
  nextRowNumber: number;
  evaluatedAtIso: string;
  status: "in_progress" | "completed";
  report: AgedBulkEnrichmentReport;
};

async function loadEnrichCheckpoint(
  workDir: string,
  fileSha256: string
): Promise<EnrichCheckpoint | null> {
  try {
    const raw = await readFile(enrichCheckpointPath(workDir, fileSha256), "utf8");
    const parsed = JSON.parse(raw) as EnrichCheckpoint;
    if (parsed.version !== ENRICH_CHECKPOINT_VERSION) return null;
    if (parsed.fileSha256 !== fileSha256) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeEnrichCheckpoint(workDir: string, checkpoint: EnrichCheckpoint) {
  await mkdir(workDir, { recursive: true });
  await writeFile(enrichCheckpointPath(workDir, checkpoint.fileSha256), JSON.stringify(checkpoint), "utf8");
}

async function updateSourceLeadEventJsonOnly(
  db: PrismaClient,
  eventId: string,
  data: {
    normalizedPayloadJson: Prisma.InputJsonValue;
    rawPayloadJson: Prisma.InputJsonValue;
    enrichmentMetadataJson: Prisma.InputJsonValue;
  }
) {
  await db.sourceLeadEvent.update({
    where: { id: eventId },
    data: {
      normalizedPayloadJson: data.normalizedPayloadJson,
      rawPayloadJson: data.rawPayloadJson,
      enrichmentMetadataJson: data.enrichmentMetadataJson,
    },
  });
}

type PendingCandidate = {
  row: AgedBulkNormalizedRow;
  incomingPayload: Record<string, unknown>;
};

async function lookupEventsBySourceLeadIds(
  db: PrismaClient,
  sourceLeadIds: string[]
): Promise<Map<string, ExistingEventRow[]>> {
  if (!sourceLeadIds.length) return new Map();
  const rows = (await db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceLeadId: { in: sourceLeadIds },
    },
    select: {
      id: true,
      sourceLeadId: true,
      normalizedPayloadJson: true,
      rawPayloadJson: true,
      enrichmentMetadataJson: true,
    },
  })) as ExistingEventRow[];

  const grouped = new Map<string, ExistingEventRow[]>();
  for (const row of rows) {
    const id = row.sourceLeadId ?? "";
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}

function applyCandidateToReport(
  report: AgedBulkEnrichmentReport,
  sourceFormat: AgedBulkSourceFormat,
  candidate: PendingCandidate,
  matches: ExistingEventRow[]
): {
  eventId: string;
  nextNormalized: Record<string, unknown>;
  nextRaw: Record<string, unknown>;
  nextMeta: Record<string, unknown>;
} | null {
  const fields = coverageFieldsFor(sourceFormat);
  const kind = classifySourceLeadIdMatch(matches);
  if (kind === "unmatched_source_lead_id") {
    report.unmatchedRows += 1;
    return null;
  }
  if (kind === "ambiguous_source_lead_id") {
    report.ambiguousRows += 1;
    return null;
  }

  const existing = matches[0]!;
  report.exactExistingMatches += 1;
  addCoverageSample(report.coverageBefore, existing.normalizedPayloadJson, fields);

  const merge = mergeNormalizedPayloadForEnrichment(existing.normalizedPayloadJson, candidate.incomingPayload);
  addCoverageSample(report.coverageAfter, merge.merged, fields);

  if (merge.conflictFields.length) report.fieldConflictRows += 1;
  if (merge.filledFields.length) report.rowsNeedingEnrichment += 1;
  if (!merge.filledFields.length && !merge.conflictFields.length) {
    report.rowsAlreadyEquivalent += 1;
  }

  const existingRaw = asRecord(existing.rawPayloadJson);
  const nextRaw = mergeAgedBulkRawPayload(existing.rawPayloadJson, {
    importRequestId:
      typeof existingRaw?.importRequestId === "string" ? String(existingRaw.importRequestId) : "",
    rowNumber:
      typeof existingRaw?.rowNumber === "number" ? Number(existingRaw.rowNumber) : candidate.row.rowNumber,
    internalSource: candidate.row.internalSource,
  });
  const existingMeta = asRecord(existing.enrichmentMetadataJson);
  const rawChanged = !jsonEqual(nextRaw, existing.rawPayloadJson);
  const metaMissing = !asRecord(existingMeta?.historicalEnrichment);
  const wouldWrite = merge.changed || rawChanged || metaMissing;

  if (!wouldWrite) return null;
  report.proposedSourceLeadEventUpdates += 1;
  return {
    eventId: existing.id,
    nextNormalized: merge.merged,
    nextRaw,
    nextMeta: existingMeta ?? {},
  };
}

export async function runAgedInventoryBulkEnrichmentBackfill(
  args: AgedBulkCliArgs,
  db: PrismaClient
) {
  const mode = args.mode;
  if (mode !== "enrich-preview" && mode !== "enrich-commit") {
    throw new Error("invalid_enrich_mode");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_required");
  const dbIdentity = assertExpectedDbHost({
    databaseUrl,
    expectedDbHost: args.expectedDbHost,
  });

  if (!args.operator.trim()) throw new Error("operator_required");

  const nicheKey = resolveDefaultNiche(args.sourceFormat, args.defaultNiche);
  const batchSize = Math.min(
    Math.max(1, args.batchSize || AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE),
    AGED_INVENTORY_BULK_MAX_BATCH_SIZE
  );

  const { sha256, sizeBytes } = await assertFileSha256(args.file, args.expectedFileSha256);
  progressLog("enrich_file_checksum_ok", {
    sizeBytes,
    sha256Prefix: sha256.slice(0, 12),
    db: dbIdentity.sanitized,
    mode,
  });

  if (mode === "enrich-commit") {
    if (args.confirmation !== AGED_INVENTORY_BULK_ENRICH_COMMIT_CONFIRMATION) {
      throw new Error("invalid_enrich_confirmation");
    }
  }

  const evaluatedAt = new Date();
  const identityIndex = createIdentityConflictIndex();
  const report = emptyReport(mode, args.sourceFormat);
  const seenSourceLeadIds = new Set<string>();
  let headerIndex: Map<string, number> | null = null;
  let pending: PendingCandidate[] = [];
  let startRowNumber = 1;
  const writing = mode === "enrich-commit";

  if (writing) {
    const checkpoint = await loadEnrichCheckpoint(args.workDir, sha256);
    if (
      checkpoint &&
      checkpoint.sourceFormat === args.sourceFormat &&
      checkpoint.status === "in_progress"
    ) {
      startRowNumber = checkpoint.nextRowNumber;
      Object.assign(report, checkpoint.report);
      progressLog("enrich_resume", {
        nextRowNumber: startRowNumber,
        sha256Prefix: sha256.slice(0, 12),
      });
    }
  }

  const persistCheckpoint = async (
    nextRowNumber: number,
    status: EnrichCheckpoint["status"] = "in_progress"
  ) => {
    if (!writing) return;
    await writeEnrichCheckpoint(args.workDir, {
      version: ENRICH_CHECKPOINT_VERSION,
      fileSha256: sha256,
      sourceFormat: args.sourceFormat,
      nextRowNumber,
      evaluatedAtIso: evaluatedAt.toISOString(),
      status,
      report,
    });
  };

  const flush = async () => {
    if (!pending.length) return;
    const ids = pending.map((p) => p.row.sourceLeadId);
    const grouped = await lookupEventsBySourceLeadIds(db, ids);
    const updates: Array<{
      eventId: string;
      nextNormalized: Record<string, unknown>;
      nextRaw: Record<string, unknown>;
      nextMeta: Record<string, unknown>;
      consumerAgeParseStatus: string;
    }> = [];

    for (const candidate of pending) {
      const prepared = applyCandidateToReport(
        report,
        args.sourceFormat,
        candidate,
        grouped.get(candidate.row.sourceLeadId) ?? []
      );
      if (prepared) {
        updates.push({
          ...prepared,
          consumerAgeParseStatus: candidate.row.consumerAgeParseStatus,
        });
      }
    }

    if (writing && updates.length) {
      for (const update of updates) {
        const nextMeta = mergeEnrichmentMetadata(update.nextMeta, {
          operator: args.operator,
          sourceFormat: args.sourceFormat,
          fileSha256Prefix: sha256.slice(0, 12),
          consumerAgeParseStatus: update.consumerAgeParseStatus,
          evaluatedAtIso: evaluatedAt.toISOString(),
        });
        await updateSourceLeadEventJsonOnly(db, update.eventId, {
          normalizedPayloadJson: update.nextNormalized as Prisma.InputJsonValue,
          rawPayloadJson: update.nextRaw as Prisma.InputJsonValue,
          enrichmentMetadataJson: nextMeta as Prisma.InputJsonValue,
        });
        report.appliedSourceLeadEventUpdates += 1;
      }
    }

    pending = [];
  };

  const streamResult = await streamCsvFile(args.file, {
    startRowNumber,
    onHeader: async (headers) => {
      const asserted = assertMasterHeaders(headers, args.sourceFormat as AgedBulkSourceFormat);
      if (!asserted.ok) throw new Error(asserted.error);
      headerIndex = asserted.index;
    },
    onRow: async (rowNumber, cols) => {
      if (!headerIndex) throw new Error("missing_header_index");
      report.sourceRows = Math.max(report.sourceRows, rowNumber);
      const raw = adaptMasterRow({
        rowNumber,
        cols,
        index: headerIndex,
        sourceFormat: args.sourceFormat,
      });
      const normalized = normalizeMasterRow({
        raw,
        nicheKey,
        identityIndex,
        evaluatedAt,
      });
      report.parsedRows += 1;
      if (
        isInvalidConsumerAgeStatus(normalized.consumerAgeParseStatus as ConsumerAgeParseStatus) &&
        (raw.dobAgeRaw || raw.ageRaw).trim()
      ) {
        report.invalidConsumerAgeRows += 1;
      }

      if (seenSourceLeadIds.has(normalized.sourceLeadId)) {
        report.fileDuplicateSourceLeadIdRows += 1;
        return;
      }
      seenSourceLeadIds.add(normalized.sourceLeadId);

      pending.push({
        row: normalized,
        incomingPayload: buildAgedBulkNormalizedPayload(normalized),
      });
      if (pending.length >= batchSize) {
        await flush();
        await persistCheckpoint(rowNumber + 1);
      }
    },
  });

  report.sourceRows = Math.max(report.sourceRows, streamResult.dataRows);
  await flush();
  if (writing) {
    await persistCheckpoint(report.sourceRows + 1, "completed");
  }

  report.proposedLeadInventoryItemCreates = PROPOSED_LEAD_INVENTORY_ITEM_CREATES;
  report.actualLeadInventoryItemCreates = PROPOSED_LEAD_INVENTORY_ITEM_CREATES;

  await mkdir(args.workDir, { recursive: true });
  const summaryPath = path.join(args.workDir, `enrich-summary-${sha256.slice(0, 12)}.json`);
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        mode,
        db: dbIdentity.sanitized,
        fileSha256: sha256,
        nicheKey,
        report,
        note: "Aggregate enrichment report only — no row-level PII",
      },
      null,
      2
    ),
    "utf8"
  );

  progressLog("enrich_complete", {
    mode,
    exactExistingMatches: report.exactExistingMatches,
    unmatchedRows: report.unmatchedRows,
    ambiguousRows: report.ambiguousRows,
    fieldConflictRows: report.fieldConflictRows,
    proposedSourceLeadEventUpdates: report.proposedSourceLeadEventUpdates,
    proposedLeadInventoryItemCreates: report.proposedLeadInventoryItemCreates,
    appliedSourceLeadEventUpdates: report.appliedSourceLeadEventUpdates,
  });

  return {
    ok: true as const,
    db: dbIdentity.sanitized,
    fileSha256: sha256,
    nicheKey,
    report,
    summaryPath,
  };
}
