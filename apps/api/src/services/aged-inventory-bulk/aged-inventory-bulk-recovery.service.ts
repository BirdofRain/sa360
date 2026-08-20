/**
 * Dedicated historical Master recovery inventory workflow.
 * Separate from enrich-preview/enrich-commit and ordinary aged bulk import.
 * Preview is read-only. Commit creates only approved missing inventory.
 * Existing SourceLeadEvent JSON and LeadInventoryItems are never updated.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE,
  AGED_INVENTORY_BULK_MAX_BATCH_SIZE,
  AGED_INVENTORY_BULK_SOURCE_LANE,
} from "@sa360/shared";

import { buildAgedInventoryLeadUid } from "../aged-inventory-import/aged-inventory-import-classify.service.js";
import {
  adaptMasterRow,
  assertMasterHeaders,
  resolveDefaultNiche,
} from "./aged-inventory-bulk-adapters.js";
import { assertExpectedDbHost } from "./aged-inventory-bulk-db-guard.js";
import {
  buildAgedBulkNormalizedPayload,
  createIdentityConflictIndex,
  isAcceptDisposition,
  mergeAgedBulkRawPayload,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import {
  assignRecoveryGrouping,
  claimRecoverySourceLeadId,
  classifyRecoveryRowDecision,
  classifyStrongConsumerIdentity,
  invalidDispositionBucket,
  recoveryFingerprints,
  recoveryLotKey,
  recoverySourceRouteKey,
  sourceMatchKey,
  type RecoveryIdentityHit,
  type RecoveryInvalidBucket,
} from "./aged-inventory-bulk-recovery-classify.js";
import { assertFileSha256, streamCsvFile } from "./aged-inventory-bulk-stream.js";
import {
  AGED_INVENTORY_BULK_RECOVERY_COMMIT_CONFIRMATION,
  RECOVERY_HISTORICAL_DATE_CUT_ISO,
  type AgedBulkCliArgs,
  type AgedBulkNormalizedRow,
  type AgedBulkSourceFormat,
  type RecoveryGrouping,
} from "./aged-inventory-bulk.types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type AgedBulkRecoveryReport = {
  mode: "recovery-preview" | "recovery-commit";
  sourceRows: number;
  parsedRows: number;
  validRows: number;
  existingExact: number;
  existingConsumer: number;
  ambiguousConsumer: number;
  fileDuplicates: number;
  invalidRows: number;
  recoveryCandidates: number;
  historicalParserRecovery: number;
  postSnapshotMasterDelta: number;
  invalidDisposition: Record<RecoveryInvalidBucket, number>;
  ambiguousReasons: Record<string, number>;
  existingConsumerBySource: Record<string, number>;
  proposedSourceLeadEventCreates: number;
  proposedLeadInventoryItemCreates: number;
  appliedSourceLeadEventCreates: number;
  appliedLeadInventoryItemCreates: number;
  skippedExistingExact: number;
  skippedExistingConsumer: number;
  skippedAmbiguous: number;
  skippedInvalid: number;
  skippedFileDuplicate: number;
  skippedRaceDetected: number;
};

export type AgedBulkRecoveryResult = {
  ok: true;
  mode: "recovery-preview" | "recovery-commit";
  db: string;
  fileSha256: string;
  nicheKey: string;
  report: AgedBulkRecoveryReport;
  lots: Array<{ grouping: RecoveryGrouping; lotKey: string; lotId: string | null }>;
  durationMs: number;
  reportPath: string;
};

type ClassifiedRow = {
  row: AgedBulkNormalizedRow;
  grouping: RecoveryGrouping;
};

function emptyInvalidDisposition(): Record<RecoveryInvalidBucket, number> {
  return {
    quarantine_identity_conflict: 0,
    reject_invalid_state: 0,
    reject_invalid_date: 0,
    reject_invalid_name: 0,
    other: 0,
  };
}

function emptyReport(mode: AgedBulkRecoveryReport["mode"]): AgedBulkRecoveryReport {
  return {
    mode,
    sourceRows: 0,
    parsedRows: 0,
    validRows: 0,
    existingExact: 0,
    existingConsumer: 0,
    ambiguousConsumer: 0,
    fileDuplicates: 0,
    invalidRows: 0,
    recoveryCandidates: 0,
    historicalParserRecovery: 0,
    postSnapshotMasterDelta: 0,
    invalidDisposition: emptyInvalidDisposition(),
    ambiguousReasons: {},
    existingConsumerBySource: {},
    proposedSourceLeadEventCreates: 0,
    proposedLeadInventoryItemCreates: 0,
    appliedSourceLeadEventCreates: 0,
    appliedLeadInventoryItemCreates: 0,
    skippedExistingExact: 0,
    skippedExistingConsumer: 0,
    skippedAmbiguous: 0,
    skippedInvalid: 0,
    skippedFileDuplicate: 0,
    skippedRaceDetected: 0,
  };
}

function progressLog(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...data }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function asRecoveryMode(mode: AgedBulkCliArgs["mode"]): "recovery-preview" | "recovery-commit" {
  if (mode !== "recovery-preview" && mode !== "recovery-commit") {
    throw new Error("invalid_recovery_mode");
  }
  return mode;
}

async function loadExactSourceIds(
  db: DbClient,
  sourceLeadIds: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  if (!sourceLeadIds.length) return found;
  for (const ids of chunk(sourceLeadIds, 500)) {
    const rows = await db.sourceLeadEvent.findMany({
      where: { sourceLeadId: { in: ids } },
      select: { sourceLeadId: true },
    });
    for (const row of rows) {
      if (row.sourceLeadId) found.add(row.sourceLeadId);
    }
  }
  return found;
}

async function loadIdentityHits(
  db: DbClient,
  input: { phoneFingerprints: string[]; emailFingerprints: string[] }
): Promise<{ byPhone: Map<string, RecoveryIdentityHit[]>; byEmail: Map<string, RecoveryIdentityHit[]> }> {
  const byPhone = new Map<string, RecoveryIdentityHit[]>();
  const byEmail = new Map<string, RecoveryIdentityHit[]>();
  if (!input.phoneFingerprints.length && !input.emailFingerprints.length) {
    return { byPhone, byEmail };
  }

  const wantedPhone = new Set(input.phoneFingerprints);
  const wantedEmail = new Set(input.emailFingerprints);
  const phoneChunks = chunk(input.phoneFingerprints, 500);
  const emailChunks = chunk(input.emailFingerprints, 500);
  const maxChunks = Math.max(phoneChunks.length, emailChunks.length, 1);
  const rows: Array<{
    id: string;
    sourceLeadEventId: string;
    sourceProvider: string;
    sourceLane: string;
    phoneFingerprint: string | null;
    emailFingerprint: string | null;
    sourceLeadEvent: { sourceSystem: string } | null;
  }> = [];

  for (let i = 0; i < maxChunks; i++) {
    const batchOr: Prisma.LeadInventoryItemWhereInput[] = [];
    const phones = phoneChunks[i];
    const emails = emailChunks[i];
    if (phones?.length) batchOr.push({ phoneFingerprint: { in: phones } });
    if (emails?.length) batchOr.push({ emailFingerprint: { in: emails } });
    if (!batchOr.length) continue;
    const batch = await db.leadInventoryItem.findMany({
      where: { OR: batchOr },
      select: {
        id: true,
        sourceLeadEventId: true,
        sourceProvider: true,
        sourceLane: true,
        phoneFingerprint: true,
        emailFingerprint: true,
        sourceLeadEvent: { select: { sourceSystem: true } },
      },
    });
    rows.push(...batch);
  }

  for (const row of rows) {
    const hit: RecoveryIdentityHit = {
      inventoryItemId: row.id,
      sourceLeadEventId: row.sourceLeadEventId,
      sourceProvider: String(row.sourceProvider),
      sourceSystem: String(row.sourceLeadEvent?.sourceSystem ?? "unknown"),
      sourceLane: row.sourceLane,
      phoneFingerprint: row.phoneFingerprint,
      emailFingerprint: row.emailFingerprint,
    };
    if (hit.phoneFingerprint && wantedPhone.has(hit.phoneFingerprint)) {
      const list = byPhone.get(hit.phoneFingerprint) ?? [];
      list.push(hit);
      byPhone.set(hit.phoneFingerprint, list);
    }
    if (hit.emailFingerprint && wantedEmail.has(hit.emailFingerprint)) {
      const list = byEmail.get(hit.emailFingerprint) ?? [];
      list.push(hit);
      byEmail.set(hit.emailFingerprint, list);
    }
  }
  return { byPhone, byEmail };
}

async function findIdentityHitsForRow(
  db: DbClient,
  row: AgedBulkNormalizedRow
): Promise<{ phoneHits: RecoveryIdentityHit[]; emailHits: RecoveryIdentityHit[] }> {
  const fps = recoveryFingerprints(row);
  const phones = fps.phoneFingerprint ? [fps.phoneFingerprint] : [];
  const emails = fps.emailFingerprint ? [fps.emailFingerprint] : [];
  const index = await loadIdentityHits(db, {
    phoneFingerprints: phones,
    emailFingerprints: emails,
  });
  return {
    phoneHits: fps.phoneFingerprint ? (index.byPhone.get(fps.phoneFingerprint) ?? []) : [],
    emailHits: fps.emailFingerprint ? (index.byEmail.get(fps.emailFingerprint) ?? []) : [],
  };
}

async function acquireRecoveryIdentityLocks(
  tx: Prisma.TransactionClient,
  row: AgedBulkNormalizedRow
) {
  const fps = recoveryFingerprints(row);
  const seeds = [
    fps.phoneFingerprint,
    fps.emailFingerprint,
    `manual_import:csv_import:${row.sourceLeadId}`,
  ].filter((seed): seed is string => Boolean(seed));
  for (const seed of seeds) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inv-id:${seed}`}))`;
  }
}

async function ensureRecoveryLot(
  db: PrismaClient,
  input: {
    grouping: RecoveryGrouping;
    nicheKey: string;
    fileSha256: string;
    sourceFormat: AgedBulkSourceFormat;
    operator: string;
    importRequestId: string;
    evaluatedAt: Date;
  }
): Promise<{ lotKey: string; lotId: string }> {
  const lotKey = recoveryLotKey({
    grouping: input.grouping,
    nicheKey: input.nicheKey,
    fileSha256: input.fileSha256,
  });
  const existing = await db.inventoryLot.findUnique({ where: { lotKey } });
  if (existing) return { lotKey, lotId: existing.id };

  const dateBound =
    input.grouping === "HISTORICAL_PARSER_RECOVERY"
      ? { generatedTo: new Date(`${RECOVERY_HISTORICAL_DATE_CUT_ISO}T23:59:59.000Z`) }
      : { generatedFrom: new Date(`${RECOVERY_HISTORICAL_DATE_CUT_ISO}T23:59:59.001Z`) };

  const lot = await db.inventoryLot.create({
    data: {
      lotKey,
      displayName: `Aged recovery ${input.grouping} ${input.nicheKey} ${input.fileSha256.slice(0, 12)}`,
      sourceProvider: "manual_import",
      sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
      nicheKey: input.nicheKey,
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
      activatedAt: input.evaluatedAt,
      ...dateBound,
      metadataJson: {
        fileSha256: input.fileSha256,
        recoveryReason: input.grouping,
        dateCut: RECOVERY_HISTORICAL_DATE_CUT_ISO,
        dateCutInclusive: true,
        operator: input.operator,
        sourceFormat: input.sourceFormat,
        originalMasterProvenance: input.sourceFormat,
        importClass: "aged_inventory_bulk_recovery",
        importRequestId: input.importRequestId,
      },
    },
  });
  return { lotKey, lotId: lot.id };
}

async function createRecoveryInventoryPair(
  tx: Prisma.TransactionClient,
  input: {
    row: AgedBulkNormalizedRow;
    grouping: RecoveryGrouping;
    lotId: string;
    lotKey: string;
    importRequestId: string;
    receivedAt: Date;
  }
) {
  const fps = recoveryFingerprints(input.row);
  const leadUid = buildAgedInventoryLeadUid(input.row.sourceLeadId);
  const normalizedPayloadJson = buildAgedBulkNormalizedPayload(input.row) as Prisma.JsonObject;
  const sourceLeadEvent = await tx.sourceLeadEvent.create({
    data: {
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceType: "bulk_import",
      sourceRouteKey: recoverySourceRouteKey(input.grouping, input.lotKey),
      sourceCampaignName: input.row.campaignName,
      sourceLeadId: input.row.sourceLeadId,
      sourceLeadUid: leadUid,
      status: "normalized",
      rawPayloadJson: mergeAgedBulkRawPayload(null, {
        importRequestId: input.importRequestId,
        rowNumber: input.row.rowNumber,
        internalSource: input.row.internalSource,
      }) as Prisma.InputJsonValue,
      normalizedPayloadJson,
      enrichmentMetadataJson: {
        sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
        generatedAt: input.row.generatedAt.toISOString(),
        importClass: "aged_inventory_bulk_recovery",
        recoveryGrouping: input.grouping,
        recoveryReason: input.grouping,
        disposition: "recovery_candidate",
        consumerAgeParseStatus: input.row.consumerAgeParseStatus,
        zipPresent: Boolean(input.row.zip),
      },
      receivedAt: input.receivedAt,
      normalizedAt: input.receivedAt,
    },
  });

  await tx.leadInventoryItem.create({
    data: {
      inventoryLotId: input.lotId,
      sourceLeadEventId: sourceLeadEvent.id,
      generatedAt: input.row.generatedAt,
      normalizedState: input.row.state,
      nicheKey: input.row.nicheKey,
      sourceProvider: "manual_import",
      sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "pending_review",
      phoneFingerprint: fps.phoneFingerprint,
      emailFingerprint: fps.emailFingerprint,
      metadataJson: {
        importRequestId: input.importRequestId,
        rowNumber: input.row.rowNumber,
        recoveryGrouping: input.grouping,
        recoveryReason: input.grouping,
        campaignNamePresent: Boolean(input.row.campaignName),
        statusRaw: input.row.statusRaw,
        usedByPresent: input.row.usedByPresent,
      },
    },
  });
}

async function commitRecoveryCandidate(
  db: PrismaClient,
  input: {
    row: AgedBulkNormalizedRow;
    grouping: RecoveryGrouping;
    lotId: string;
    lotKey: string;
    importRequestId: string;
    receivedAt: Date;
  }
): Promise<"created" | "race_exact" | "race_consumer" | "race_ambiguous"> {
  return db.$transaction(
    async (tx) => {
      await acquireRecoveryIdentityLocks(tx, input.row);

      const existingExact = await tx.sourceLeadEvent.findFirst({
        where: { sourceLeadId: input.row.sourceLeadId },
        select: { id: true },
      });
      if (existingExact) return "race_exact";

      const hits = await findIdentityHitsForRow(tx, input.row);
      const consumer = classifyStrongConsumerIdentity(hits);
      if (consumer.kind === "existing_consumer") return "race_consumer";
      if (consumer.kind === "ambiguous") return "race_ambiguous";

      await createRecoveryInventoryPair(tx, input);
      return "created";
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
}

export async function runAgedInventoryBulkRecovery(
  args: AgedBulkCliArgs,
  db: PrismaClient
): Promise<AgedBulkRecoveryResult> {
  const mode = asRecoveryMode(args.mode);
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
  progressLog("recovery_file_checksum_ok", {
    sizeBytes,
    sha256Prefix: sha256.slice(0, 12),
    db: dbIdentity.sanitized,
    mode,
  });

  if (mode === "recovery-commit") {
    if (args.confirmation !== AGED_INVENTORY_BULK_RECOVERY_COMMIT_CONFIRMATION) {
      throw new Error("invalid_recovery_confirmation");
    }
  }

  const evaluatedAt = new Date();
  const identityIndex = createIdentityConflictIndex();
  const report = emptyReport(mode);
  const writing = mode === "recovery-commit";
  const importRequestId =
    args.requestId ?? `aged-recovery-${nicheKey}-${sha256.slice(0, 12)}`;

  let headerIndex: Map<string, number> | null = null;
  const recoverySeenSourceIds = new Set<string>();
  const validFirstOccurrence: ClassifiedRow[] = [];
  const started = Date.now();

  const streamResult = await streamCsvFile(args.file, {
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

      const fileOccurrence = claimRecoverySourceLeadId(recoverySeenSourceIds, normalized);
      if (
        fileOccurrence === "FILE_DUPLICATE" ||
        normalized.disposition === "exact_source_duplicate"
      ) {
        report.fileDuplicates += 1;
        report.skippedFileDuplicate += 1;
        return;
      }
      if (!isAcceptDisposition(normalized.disposition)) {
        report.invalidRows += 1;
        report.skippedInvalid += 1;
        const bucket = invalidDispositionBucket(normalized.disposition);
        report.invalidDisposition[bucket] += 1;
        return;
      }

      report.validRows += 1;
      validFirstOccurrence.push({
        row: normalized,
        grouping: assignRecoveryGrouping(normalized.generatedAt),
      });
    },
  });

  report.sourceRows = streamResult.dataRows;
  report.parsedRows = streamResult.dataRows;

  const sourceIds = validFirstOccurrence.map((c) => c.row.sourceLeadId);
  const existingExactIds = await loadExactSourceIds(db, sourceIds);

  const pendingIdentity: ClassifiedRow[] = [];
  for (const candidate of validFirstOccurrence) {
    if (existingExactIds.has(candidate.row.sourceLeadId)) {
      report.existingExact += 1;
      report.skippedExistingExact += 1;
    } else {
      pendingIdentity.push(candidate);
    }
  }

  const phoneFingerprints: string[] = [];
  const emailFingerprints: string[] = [];
  for (const candidate of pendingIdentity) {
    const fps = recoveryFingerprints(candidate.row);
    if (fps.phoneFingerprint) phoneFingerprints.push(fps.phoneFingerprint);
    if (fps.emailFingerprint) emailFingerprints.push(fps.emailFingerprint);
  }
  const identityIndexDb = await loadIdentityHits(db, {
    phoneFingerprints: [...new Set(phoneFingerprints)],
    emailFingerprints: [...new Set(emailFingerprints)],
  });

  const createQueue: ClassifiedRow[] = [];
  for (const candidate of pendingIdentity) {
    const fps = recoveryFingerprints(candidate.row);
    const consumer = classifyStrongConsumerIdentity({
      phoneHits: fps.phoneFingerprint
        ? (identityIndexDb.byPhone.get(fps.phoneFingerprint) ?? [])
        : [],
      emailHits: fps.emailFingerprint
        ? (identityIndexDb.byEmail.get(fps.emailFingerprint) ?? [])
        : [],
    });
    const decision = classifyRecoveryRowDecision({
      row: candidate.row,
      exactSourceExists: false,
      consumer,
    });
    if (decision === "EXISTING_CONSUMER") {
      report.existingConsumer += 1;
      report.skippedExistingConsumer += 1;
      const hit = consumer.kind === "existing_consumer" ? consumer.hits[0] : undefined;
      if (hit) {
        const key = sourceMatchKey(hit);
        report.existingConsumerBySource[key] = (report.existingConsumerBySource[key] ?? 0) + 1;
      }
      continue;
    }
    if (decision === "AMBIGUOUS") {
      report.ambiguousConsumer += 1;
      report.skippedAmbiguous += 1;
      const reason = consumer.kind === "ambiguous" ? consumer.reason : "multiple_identity_matches";
      report.ambiguousReasons[reason] = (report.ambiguousReasons[reason] ?? 0) + 1;
      continue;
    }
    createQueue.push(candidate);
    if (candidate.grouping === "HISTORICAL_PARSER_RECOVERY") {
      report.historicalParserRecovery += 1;
    } else {
      report.postSnapshotMasterDelta += 1;
    }
  }

  report.recoveryCandidates = createQueue.length;
  report.proposedSourceLeadEventCreates = createQueue.length;
  report.proposedLeadInventoryItemCreates = createQueue.length;

  const lots: AgedBulkRecoveryResult["lots"] = [
    {
      grouping: "HISTORICAL_PARSER_RECOVERY",
      lotKey: recoveryLotKey({
        grouping: "HISTORICAL_PARSER_RECOVERY",
        nicheKey,
        fileSha256: sha256,
      }),
      lotId: null,
    },
    {
      grouping: "POST_SNAPSHOT_MASTER_DELTA",
      lotKey: recoveryLotKey({
        grouping: "POST_SNAPSHOT_MASTER_DELTA",
        nicheKey,
        fileSha256: sha256,
      }),
      lotId: null,
    },
  ];

  if (writing) {
    const lotByGrouping = new Map<RecoveryGrouping, { lotKey: string; lotId: string }>();
    const neededGroupings = new Set(createQueue.map((candidate) => candidate.grouping));
    for (const grouping of neededGroupings) {
      const lot = await ensureRecoveryLot(db, {
        grouping,
        nicheKey,
        fileSha256: sha256,
        sourceFormat: args.sourceFormat,
        operator: args.operator,
        importRequestId,
        evaluatedAt,
      });
      lotByGrouping.set(grouping, lot);
      const slot = lots.find((l) => l.grouping === grouping);
      if (slot) slot.lotId = lot.lotId;
    }

    for (const slice of chunk(createQueue, batchSize)) {
      for (const candidate of slice) {
        const lot = lotByGrouping.get(candidate.grouping);
        if (!lot) throw new Error("recovery_lot_missing");
        const outcome = await commitRecoveryCandidate(db, {
          row: candidate.row,
          grouping: candidate.grouping,
          lotId: lot.lotId,
          lotKey: lot.lotKey,
          importRequestId,
          receivedAt: evaluatedAt,
        });
        if (outcome === "created") {
          report.appliedSourceLeadEventCreates += 1;
          report.appliedLeadInventoryItemCreates += 1;
        } else {
          report.skippedRaceDetected += 1;
        }
      }
      progressLog("recovery_batch_progress", {
        applied: report.appliedSourceLeadEventCreates,
        proposed: report.proposedSourceLeadEventCreates,
        raceSkipped: report.skippedRaceDetected,
      });
    }
  }

  const durationMs = Date.now() - started;
  await mkdir(args.workDir, { recursive: true });
  const reportPath = path.join(
    args.workDir,
    `recovery-${mode}-${sha256.slice(0, 12)}.json`
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        note: "Aggregate recovery report only — no row-level PII",
        db: dbIdentity.sanitized,
        fileSha256: sha256,
        nicheKey,
        lots,
        report,
        durationMs,
      },
      null,
      2
    ),
    "utf8"
  );

  progressLog("recovery_complete", {
    mode,
    sourceRows: report.sourceRows,
    recoveryCandidates: report.recoveryCandidates,
    applied: report.appliedSourceLeadEventCreates,
    existingExact: report.existingExact,
    existingConsumer: report.existingConsumer,
    ambiguousConsumer: report.ambiguousConsumer,
    fileDuplicates: report.fileDuplicates,
    invalidRows: report.invalidRows,
  });

  return {
    ok: true,
    mode,
    db: dbIdentity.sanitized,
    fileSha256: sha256,
    nicheKey,
    report,
    lots,
    durationMs,
    reportPath,
  };
}
