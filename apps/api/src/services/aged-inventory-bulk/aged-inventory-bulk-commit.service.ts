import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE,
  AGED_INVENTORY_BULK_MAX_BATCH_SIZE,
  AGED_INVENTORY_BULK_SOURCE_LANE,
  AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION,
} from "@sa360/shared";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { buildAgedInventoryLeadUid } from "../aged-inventory-import/aged-inventory-import-classify.service.js";
import {
  adaptMasterRow,
  assertMasterHeaders,
  resolveDefaultNiche,
} from "./aged-inventory-bulk-adapters.js";
import {
  RollingSetFingerprint,
  assertCheckpointUsableForResume,
  assertDiskAndDbCheckpointsAgree,
  buildCheckpointPayload,
  loadAgedBulkCheckpoint,
  parseDbCheckpointJson,
  writeAgedBulkCheckpoint,
  type AgedBulkCheckpointCounts,
} from "./aged-inventory-bulk-checkpoint.js";
import { assertExpectedDbHost } from "./aged-inventory-bulk-db-guard.js";
import {
  buildAgedBulkNormalizedPayload,
  createIdentityConflictIndex,
  isAcceptDisposition,
  mergeAgedBulkRawPayload,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import { rescanSourceRowsForResume } from "./aged-inventory-bulk-rescan.js";
import { assertFileSha256, streamCsvFile } from "./aged-inventory-bulk-stream.js";
import type {
  AgedBulkAggregateCounts,
  AgedBulkCliArgs,
  AgedBulkNormalizedRow,
  AgedBulkSourceFormat,
} from "./aged-inventory-bulk.types.js";

function emptyCounts(): AgedBulkAggregateCounts {
  return {
    sourceRows: 0,
    parsedRows: 0,
    acceptedRows: 0,
    exactDuplicateRows: 0,
    quarantinedRows: 0,
    rejectedRows: 0,
    importedRows: 0,
    emailIssueRetainedRows: 0,
    pulledStatusRows: 0,
    usedByPresentRows: 0,
    byDisposition: {},
    byState: {},
    byAgeBand: {},
  };
}

function bump(counts: AgedBulkAggregateCounts, row: AgedBulkNormalizedRow, ageBandKey: string | null) {
  counts.parsedRows += 1;
  counts.byDisposition[row.disposition] = (counts.byDisposition[row.disposition] ?? 0) + 1;
  if (row.statusRaw?.toUpperCase() === "PULLED") counts.pulledStatusRows += 1;
  if (row.usedByPresent) counts.usedByPresentRows += 1;

  if (isAcceptDisposition(row.disposition)) {
    counts.acceptedRows += 1;
    if (row.disposition === "email_issue_retained") counts.emailIssueRetainedRows += 1;
    if (row.state) counts.byState[row.state] = (counts.byState[row.state] ?? 0) + 1;
    if (ageBandKey) counts.byAgeBand[ageBandKey] = (counts.byAgeBand[ageBandKey] ?? 0) + 1;
  } else if (
    row.disposition === "exact_source_duplicate" ||
    row.disposition === "identity_duplicate_same_date" ||
    row.disposition === "already_inventory"
  ) {
    counts.exactDuplicateRows += 1;
  } else if (row.disposition === "quarantine_identity_conflict") {
    counts.quarantinedRows += 1;
  } else {
    counts.rejectedRows += 1;
  }
}

function progressLog(msg: string, data: Record<string, unknown>) {
  // PII-safe: never log names/emails/phones/source ids in full
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...data }));
}

async function writeRejectAggregate(
  workDir: string,
  fileSha256: string,
  counts: AgedBulkAggregateCounts
) {
  await mkdir(workDir, { recursive: true });
  const rejectPath = path.join(workDir, `rejects-${fileSha256.slice(0, 12)}.json`);
  await writeFile(
    rejectPath,
    JSON.stringify(
      {
        fileSha256,
        generatedAt: new Date().toISOString(),
        note: "Aggregate rejection report only — no row-level PII",
        byDisposition: counts.byDisposition,
        quarantinedRows: counts.quarantinedRows,
        rejectedRows: counts.rejectedRows,
        exactDuplicateRows: counts.exactDuplicateRows,
      },
      null,
      2
    ),
    "utf8"
  );
  return rejectPath;
}

function toCheckpointCounts(counts: AgedBulkAggregateCounts): AgedBulkCheckpointCounts {
  return {
    parsedRows: counts.parsedRows,
    acceptedRows: counts.acceptedRows,
    exactDuplicateRows: counts.exactDuplicateRows,
    quarantinedRows: counts.quarantinedRows,
    rejectedRows: counts.rejectedRows,
    importedRows: counts.importedRows,
    emailIssueRetainedRows: counts.emailIssueRetainedRows,
    pulledStatusRows: counts.pulledStatusRows,
    usedByPresentRows: counts.usedByPresentRows,
    byDisposition: { ...counts.byDisposition },
  };
}

function applyCheckpointCounts(
  counts: AgedBulkAggregateCounts,
  seeded: AgedBulkCheckpointCounts,
  byState: Record<string, number>,
  byAgeBand: Record<string, number>
) {
  counts.parsedRows = seeded.parsedRows;
  counts.acceptedRows = seeded.acceptedRows;
  counts.exactDuplicateRows = seeded.exactDuplicateRows;
  counts.quarantinedRows = seeded.quarantinedRows;
  counts.rejectedRows = seeded.rejectedRows;
  counts.emailIssueRetainedRows = seeded.emailIssueRetainedRows;
  counts.pulledStatusRows = seeded.pulledStatusRows;
  counts.usedByPresentRows = seeded.usedByPresentRows;
  counts.byDisposition = { ...seeded.byDisposition };
  counts.byState = { ...byState };
  counts.byAgeBand = { ...byAgeBand };
}

function updateSetFingerprints(
  row: AgedBulkNormalizedRow,
  acceptedFp: RollingSetFingerprint,
  quarantinedFp: RollingSetFingerprint,
  rejectedFp: RollingSetFingerprint
) {
  if (isAcceptDisposition(row.disposition)) {
    acceptedFp.update(row.sourceLeadId);
  } else if (row.disposition === "quarantine_identity_conflict") {
    quarantinedFp.update(row.sourceLeadId);
  } else if (
    row.disposition !== "exact_source_duplicate" &&
    row.disposition !== "identity_duplicate_same_date" &&
    row.disposition !== "already_inventory"
  ) {
    rejectedFp.update(row.sourceLeadId);
  }
}

async function importBatch(
  db: PrismaClient,
  input: {
    rows: AgedBulkNormalizedRow[];
    lotId: string;
    lotKey: string;
    nicheKey: string;
    sourceProvider: "manual_import";
    sourceLane: string;
    exclusivityMode: "exclusive";
    importRequestId: string;
    receivedAt: Date;
  }
): Promise<{ imported: number; skippedExisting: number }> {
  let imported = 0;
  let skippedExisting = 0;
  const ready = input.rows.filter((r) => isAcceptDisposition(r.disposition));
  if (!ready.length) return { imported, skippedExisting };

  const sourceIds = ready.map((r) => r.sourceLeadId);
  const existingEvents = await db.sourceLeadEvent.findMany({
    where: {
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceLeadId: { in: sourceIds },
    },
    select: { sourceLeadId: true, leadInventoryItem: { select: { id: true } } },
  });
  const existingIds = new Set(existingEvents.map((e) => e.sourceLeadId));
  skippedExisting = existingIds.size;
  const toInsert = ready.filter((r) => !existingIds.has(r.sourceLeadId));

  // Smaller sub-batches keep interactive transactions under the timeout.
  const SUB_BATCH = 50;
  for (let i = 0; i < toInsert.length; i += SUB_BATCH) {
    const slice = toInsert.slice(i, i + SUB_BATCH);
    await db.$transaction(
      async (tx) => {
        for (const row of slice) {
          const leadUid = buildAgedInventoryLeadUid(row.sourceLeadId);
          const normalizedPayloadJson = buildAgedBulkNormalizedPayload(row) as Prisma.JsonObject;

          const sourceLeadEvent = await tx.sourceLeadEvent.create({
            data: {
              sourceProvider: input.sourceProvider,
              sourceSystem: "csv_import",
              sourceType: "bulk_import",
              sourceRouteKey: `AGED_BULK::${input.lotKey}`,
              sourceCampaignName: row.campaignName,
              sourceLeadId: row.sourceLeadId,
              sourceLeadUid: leadUid,
              status: "normalized",
              rawPayloadJson: mergeAgedBulkRawPayload(null, {
                importRequestId: input.importRequestId,
                rowNumber: row.rowNumber,
                internalSource: row.internalSource,
              }) as Prisma.InputJsonValue,
              normalizedPayloadJson,
              enrichmentMetadataJson: {
                sourceLane: input.sourceLane,
                generatedAt: row.generatedAt.toISOString(),
                importClass: "aged_inventory_bulk_csv",
                disposition: row.disposition,
                consumerAgeParseStatus: row.consumerAgeParseStatus,
                zipPresent: Boolean(row.zip),
              },
              receivedAt: input.receivedAt,
              normalizedAt: input.receivedAt,
            },
          });

          await tx.leadInventoryItem.create({
            data: {
              inventoryLotId: input.lotId,
              sourceLeadEventId: sourceLeadEvent.id,
              generatedAt: row.generatedAt,
              normalizedState: row.state,
              nicheKey: row.nicheKey,
              sourceProvider: input.sourceProvider,
              sourceLane: input.sourceLane,
              inventoryClass: "aged",
              exclusivityMode: input.exclusivityMode,
              status: "pending_review",
              phoneFingerprint: row.phoneE164
                ? fingerprintIdentityValue("phone", row.phoneE164)
                : null,
              emailFingerprint: row.email
                ? fingerprintIdentityValue("email", row.email.trim().toLowerCase())
                : null,
              metadataJson: {
                importRequestId: input.importRequestId,
                rowNumber: row.rowNumber,
                disposition: row.disposition,
                campaignNamePresent: Boolean(row.campaignName),
                statusRaw: row.statusRaw,
                usedByPresent: row.usedByPresent,
              },
            },
          });
          imported += 1;
        }
      },
      { timeout: 120_000, maxWait: 20_000 }
    );
  }

  return { imported, skippedExisting };
}

export async function runAgedInventoryBulkImport(
  args: AgedBulkCliArgs,
  db: PrismaClient
) {
  if (
    args.mode === "recovery-preview" ||
    args.mode === "recovery-commit" ||
    args.mode === "enrich-preview" ||
    args.mode === "enrich-commit"
  ) {
    throw new Error("use_dedicated_recovery_or_enrich_workflow");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_required");
  const dbIdentity = assertExpectedDbHost({
    databaseUrl,
    expectedDbHost: args.expectedDbHost,
  });

  const nicheKey = resolveDefaultNiche(args.sourceFormat, args.defaultNiche);
  const batchSize = Math.min(
    Math.max(1, args.batchSize || AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE),
    AGED_INVENTORY_BULK_MAX_BATCH_SIZE
  );

  const { sha256, sizeBytes } = await assertFileSha256(args.file, args.expectedFileSha256);
  progressLog("file_checksum_ok", {
    sizeBytes,
    sha256Prefix: sha256.slice(0, 12),
    db: dbIdentity.sanitized,
    mode: args.mode,
  });

  if (args.mode === "commit" || args.mode === "resume") {
    if (args.confirmation !== AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION) {
      throw new Error("invalid_confirmation");
    }
  }

  const existingSnapshot = await db.agedInventorySourceSnapshot.findUnique({
    where: { fileSha256: sha256 },
  });

  if (args.mode === "commit" && existingSnapshot?.status === "completed") {
    return {
      ok: true as const,
      idempotentReplay: true,
      db: dbIdentity.sanitized,
      snapshotId: existingSnapshot.id,
      lotKey: existingSnapshot.lotKey,
      inventoryLotId: existingSnapshot.inventoryLotId,
      counts: {
        sourceRows: existingSnapshot.totalSourceRows,
        parsedRows: existingSnapshot.parsedRows,
        acceptedRows: existingSnapshot.acceptedRows,
        exactDuplicateRows: existingSnapshot.exactDuplicateRows,
        quarantinedRows: existingSnapshot.quarantinedRows,
        rejectedRows: existingSnapshot.rejectedRows,
        importedRows: existingSnapshot.importedRows,
      },
    };
  }

  if (args.mode === "commit" && existingSnapshot?.status === "committing") {
    throw new Error("snapshot_committing_use_resume");
  }

  if (args.mode === "resume" && !existingSnapshot) {
    throw new Error("snapshot_not_found_for_resume");
  }
  if (args.mode === "resume" && existingSnapshot?.status === "completed") {
    return {
      ok: true as const,
      idempotentReplay: true,
      db: dbIdentity.sanitized,
      snapshotId: existingSnapshot.id,
      lotKey: existingSnapshot.lotKey,
      inventoryLotId: existingSnapshot.inventoryLotId,
      counts: {
        sourceRows: existingSnapshot.totalSourceRows,
        importedRows: existingSnapshot.importedRows,
      },
    };
  }

  const ageBands = await listActiveAgeBandDefinitions(undefined, db);
  let evaluatedAt = new Date();
  let identityIndex = createIdentityConflictIndex();
  const counts = emptyCounts();
  let acceptedFp = new RollingSetFingerprint();
  let quarantinedFp = new RollingSetFingerprint();
  let rejectedFp = new RollingSetFingerprint();
  let headerIndex: Map<string, number> | null = null;
  let batch: AgedBulkNormalizedRow[] = [];
  let lotId = existingSnapshot?.inventoryLotId ?? null;
  let lotKey =
    existingSnapshot?.lotKey ??
    args.lotKey ??
    `lot_aged_bulk_${nicheKey}_${sha256.slice(0, 12)}`;
  const importRequestId =
    existingSnapshot?.importRequestId ??
    args.requestId ??
    `aged-bulk-${nicheKey}-${sha256.slice(0, 12)}`;
  let startRowNumber = 1;
  let batchesCompleted = existingSnapshot?.batchesCompleted ?? 0;
  let lastProcessedRowNumber = 0;
  const writing = args.mode === "commit" || args.mode === "resume";
  const started = Date.now();
  let peakRss = process.memoryUsage().rss;

  if (args.mode === "resume" && existingSnapshot) {
    const dbNext = Math.max(1, existingSnapshot.nextRowNumber ?? 1);
    const diskCheckpoint = await loadAgedBulkCheckpoint(args.workDir, sha256);
    const dbCheckpoint = parseDbCheckpointJson(existingSnapshot.checkpointJson);
    assertDiskAndDbCheckpointsAgree(diskCheckpoint, dbCheckpoint);
    const checkpoint = assertCheckpointUsableForResume({
      checkpoint: diskCheckpoint ?? dbCheckpoint,
      fileSha256: sha256,
      sourceFormat: args.sourceFormat,
      defaultNicheKey: nicheKey,
      lotKey: existingSnapshot.lotKey ?? lotKey,
      importRequestId: existingSnapshot.importRequestId ?? importRequestId,
      dbNextRowNumber: dbNext,
    });
    if (!diskCheckpoint) {
      await writeAgedBulkCheckpoint(args.workDir, checkpoint);
    }
    evaluatedAt = new Date(checkpoint.evaluatedAtIso);
    lotKey = checkpoint.lotKey;
    startRowNumber = checkpoint.nextRowNumber;
    batchesCompleted = checkpoint.batchesCompleted;
    counts.importedRows = existingSnapshot.importedRows;

    progressLog("resume_rescan_start", {
      nextRowNumber: startRowNumber,
      batchesCompleted,
      sha256Prefix: sha256.slice(0, 12),
    });
    const rescan = await rescanSourceRowsForResume({
      filePath: args.file,
      sourceFormat: args.sourceFormat as AgedBulkSourceFormat,
      nicheKey,
      endExclusive: startRowNumber,
      evaluatedAt,
      ageBands,
    });
    if (rescan.acceptedFp.digest() !== checkpoint.acceptedSetRollingSha256) {
      throw new Error("checkpoint_accepted_fingerprint_mismatch_after_rescan");
    }
    if (rescan.quarantinedFp.digest() !== checkpoint.quarantinedSetRollingSha256) {
      throw new Error("checkpoint_quarantined_fingerprint_mismatch_after_rescan");
    }
    if (rescan.rejectedFp.digest() !== checkpoint.rejectedSetRollingSha256) {
      throw new Error("checkpoint_rejected_fingerprint_mismatch_after_rescan");
    }
    if (rescan.counts.acceptedRows !== checkpoint.counts.acceptedRows) {
      throw new Error("checkpoint_accepted_count_mismatch_after_rescan");
    }
    identityIndex = rescan.identityIndex;
    acceptedFp = rescan.acceptedFp;
    quarantinedFp = rescan.quarantinedFp;
    rejectedFp = rescan.rejectedFp;
    applyCheckpointCounts(counts, rescan.counts, rescan.byState, rescan.byAgeBand);
    progressLog("resume_rescan_ok", {
      rowsScanned: rescan.rowsScanned,
      acceptedRows: counts.acceptedRows,
      quarantinedRows: counts.quarantinedRows,
      identityIndexSize: identityIndex.seenSourceIds.size,
      acceptedSetRollingSha256Prefix: acceptedFp.digest().slice(0, 12),
    });
  }

  if (writing) {
    let snapshot = existingSnapshot;
    if (!snapshot) {
      snapshot = await db.agedInventorySourceSnapshot.create({
        data: {
          fileSha256: sha256,
          fileName: path.basename(args.file),
          sourceFormat: args.sourceFormat,
          defaultNicheKey: nicheKey,
          sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
          status: "committing",
          lotKey,
          importRequestId,
          operator: args.operator,
          nextRowNumber: 1,
          committedAt: evaluatedAt,
        },
      });
    } else if (snapshot.status !== "committing") {
      snapshot = await db.agedInventorySourceSnapshot.update({
        where: { id: snapshot.id },
        data: { status: "committing", operator: args.operator, committedAt: evaluatedAt },
      });
    }

    if (!lotId) {
      const lot = await db.inventoryLot.create({
        data: {
          lotKey,
          displayName: `Aged bulk ${nicheKey} ${sha256.slice(0, 12)}`,
          sourceProvider: "manual_import",
          sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
          nicheKey,
          inventoryClass: "aged",
          exclusivityMode: "exclusive",
          status: "active",
          activatedAt: evaluatedAt,
          metadataJson: {
            fileSha256: sha256,
            importRequestId,
            sourceFormat: args.sourceFormat,
            operator: args.operator,
          },
        },
      });
      lotId = lot.id;
      await db.agedInventorySourceSnapshot.update({
        where: { id: snapshot.id },
        data: { inventoryLotId: lotId, lotKey },
      });
    }
  }

  const persistProgressCheckpoint = async (reason: string) => {
    if (!writing || lastProcessedRowNumber < 1) return;
    const checkpoint = buildCheckpointPayload({
      fileSha256: sha256,
      sourceFormat: args.sourceFormat,
      defaultNicheKey: nicheKey,
      lotKey,
      importRequestId,
      evaluatedAtIso: evaluatedAt.toISOString(),
      nextRowNumber: lastProcessedRowNumber + 1,
      batchesCompleted,
      acceptedSetRollingSha256: acceptedFp.digest(),
      quarantinedSetRollingSha256: quarantinedFp.digest(),
      rejectedSetRollingSha256: rejectedFp.digest(),
      counts: toCheckpointCounts(counts),
    });
    await db.agedInventorySourceSnapshot.update({
      where: { fileSha256: sha256 },
      data: {
        nextRowNumber: lastProcessedRowNumber + 1,
        batchesCompleted,
        importedRows: counts.importedRows,
        acceptedRows: counts.acceptedRows,
        exactDuplicateRows: counts.exactDuplicateRows,
        quarantinedRows: counts.quarantinedRows,
        rejectedRows: counts.rejectedRows,
        parsedRows: counts.parsedRows,
        totalSourceRows: Math.max(counts.sourceRows, lastProcessedRowNumber),
        checkpointJson: checkpoint as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAgedBulkCheckpoint(args.workDir, checkpoint);
    progressLog("checkpoint_persisted", {
      reason,
      nextRowNumber: checkpoint.nextRowNumber,
      importedRows: counts.importedRows,
      acceptedSetRollingSha256Prefix: checkpoint.acceptedSetRollingSha256.slice(0, 12),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  };

  const flush = async () => {
    if (!batch.length) return;
    if (writing && lotId) {
      const result = await importBatch(db, {
        rows: batch,
        lotId,
        lotKey,
        nicheKey,
        sourceProvider: "manual_import",
        sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
        exclusivityMode: "exclusive",
        importRequestId,
        receivedAt: evaluatedAt,
      });
      counts.importedRows += result.imported;
      if (result.skippedExisting > 0) {
        progressLog("batch_skipped_existing", {
          skippedExisting: result.skippedExisting,
          imported: result.imported,
        });
      }
      batchesCompleted += 1;
      await persistProgressCheckpoint("batch_committed");
    }
    batch = [];
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
      counts.sourceRows = Math.max(counts.sourceRows, rowNumber);
      lastProcessedRowNumber = rowNumber;
      const raw = adaptMasterRow({
        rowNumber,
        cols,
        index: headerIndex,
        sourceFormat: args.sourceFormat,
      });
      // Lead Type must never become niche — nicheKey is CLI default only
      const normalized = normalizeMasterRow({
        raw,
        nicheKey,
        identityIndex,
        evaluatedAt,
      });
      const ageDays = isAcceptDisposition(normalized.disposition)
        ? calculateInventoryAgeDays(normalized.generatedAt, evaluatedAt)
        : null;
      const ageBandKey =
        ageDays != null ? resolveAgeBandKey(ageDays, ageBands) : null;
      bump(counts, normalized, ageBandKey);
      updateSetFingerprints(normalized, acceptedFp, quarantinedFp, rejectedFp);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);

      if (isAcceptDisposition(normalized.disposition)) {
        batch.push(normalized);
        if (batch.length >= batchSize) await flush();
      }

      if (rowNumber % 5000 === 0) {
        progressLog("progress", {
          rowNumber,
          acceptedRows: counts.acceptedRows,
          rejectedRows: counts.rejectedRows,
          quarantinedRows: counts.quarantinedRows,
          importedRows: counts.importedRows,
        });
      }

      const stopAfter = process.env.AGED_BULK_STOP_AFTER_ROW?.trim();
      if (stopAfter && Number.parseInt(stopAfter, 10) === rowNumber) {
        await flush();
        await persistProgressCheckpoint("interrupt");
        throw new Error(`interrupted_after_row:${rowNumber}`);
      }
    },
  });

  counts.sourceRows = streamResult.dataRows;
  await flush();
  if (writing && lastProcessedRowNumber >= 1) {
    await persistProgressCheckpoint("stream_complete");
  }

  const durationMs = Date.now() - started;
  const rejectPath = await writeRejectAggregate(args.workDir, sha256, counts);
  counts.parsedRows = counts.sourceRows;

  const setFingerprints = {
    acceptedSetRollingSha256: acceptedFp.digest(),
    quarantinedSetRollingSha256: quarantinedFp.digest(),
    rejectedSetRollingSha256: rejectedFp.digest(),
  };

  if (writing) {
    await db.agedInventorySourceSnapshot.update({
      where: { fileSha256: sha256 },
      data: {
        status: "completed",
        completedAt: new Date(),
        totalSourceRows: counts.sourceRows,
        parsedRows: counts.parsedRows,
        acceptedRows: counts.acceptedRows,
        exactDuplicateRows: counts.exactDuplicateRows,
        quarantinedRows: counts.quarantinedRows,
        rejectedRows: counts.rejectedRows,
        importedRows: counts.importedRows,
        summaryJson: {
          byDisposition: counts.byDisposition,
          byState: counts.byState,
          byAgeBand: counts.byAgeBand,
          pulledStatusRows: counts.pulledStatusRows,
          usedByPresentRows: counts.usedByPresentRows,
          emailIssueRetainedRows: counts.emailIssueRetainedRows,
          durationMs,
          peakRssMB: Math.round(peakRss / 1024 / 1024),
          rowsPerSecond: Math.round(counts.sourceRows / Math.max(durationMs / 1000, 0.001)),
          blankRows: streamResult.blankRows,
          checkpointVersion: "aged-bulk-checkpoint-v2",
          ...setFingerprints,
        },
      },
    });

    await db.leadInventoryImportBatch.create({
      data: {
        requestId: importRequestId,
        lotKey,
        fileName: path.basename(args.file),
        fileFingerprint: sha256,
        uploadedBy: args.operator,
        operatorNote: args.operatorNote ?? "aged bulk CLI import",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        nicheKey,
        sourceProvider: "manual_import",
        sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
        totalRows: counts.sourceRows,
        validRows: counts.acceptedRows,
        invalidRows: counts.rejectedRows,
        duplicateRows: counts.exactDuplicateRows,
        quarantinedRows: counts.quarantinedRows,
        importedRows: counts.importedRows,
        status: "committed",
        mappingJson: { sourceFormat: args.sourceFormat, adapter: "aged_bulk_v1" },
        summaryJson: {
          byState: counts.byState,
          byAgeBand: counts.byAgeBand,
          pendingReview: counts.importedRows,
        },
        previewedAt: evaluatedAt,
        committedAt: new Date(),
        inventoryLotId: lotId,
      },
    }).catch(async (err) => {
      // Idempotent resume may recreate same requestId — ignore unique conflict
      if (!(err && typeof err === "object" && "code" in err && err.code === "P2002")) {
        throw err;
      }
    });
  } else {
    // preview-only snapshot upsert
    await db.agedInventorySourceSnapshot.upsert({
      where: { fileSha256: sha256 },
      create: {
        fileSha256: sha256,
        fileName: path.basename(args.file),
        sourceFormat: args.sourceFormat,
        defaultNicheKey: nicheKey,
        sourceLane: AGED_INVENTORY_BULK_SOURCE_LANE,
        status: "previewed",
        operator: args.operator,
        totalSourceRows: counts.sourceRows,
        parsedRows: counts.parsedRows,
        acceptedRows: counts.acceptedRows,
        exactDuplicateRows: counts.exactDuplicateRows,
        quarantinedRows: counts.quarantinedRows,
        rejectedRows: counts.rejectedRows,
        previewedAt: evaluatedAt,
        summaryJson: {
          byDisposition: counts.byDisposition,
          byState: counts.byState,
          byAgeBand: counts.byAgeBand,
          durationMs,
          peakRssMB: Math.round(peakRss / 1024 / 1024),
          checkpointVersion: "aged-bulk-checkpoint-v2",
          ...setFingerprints,
        },
      },
      update: {
        status: existingSnapshot?.status === "completed" ? "completed" : "previewed",
        totalSourceRows: counts.sourceRows,
        parsedRows: counts.parsedRows,
        acceptedRows: counts.acceptedRows,
        exactDuplicateRows: counts.exactDuplicateRows,
        quarantinedRows: counts.quarantinedRows,
        rejectedRows: counts.rejectedRows,
        previewedAt: evaluatedAt,
        summaryJson: {
          byDisposition: counts.byDisposition,
          byState: counts.byState,
          byAgeBand: counts.byAgeBand,
          durationMs,
          peakRssMB: Math.round(peakRss / 1024 / 1024),
          checkpointVersion: "aged-bulk-checkpoint-v2",
          ...setFingerprints,
        },
      },
    });
  }

  const summaryPath = path.join(args.workDir, `summary-${sha256.slice(0, 12)}.json`);
  await mkdir(args.workDir, { recursive: true });
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        mode: args.mode,
        db: dbIdentity.sanitized,
        fileSha256: sha256,
        nicheKey,
        lotKey,
        lotId,
        counts,
        setFingerprints,
        durationMs,
        peakRssMB: Math.round(peakRss / 1024 / 1024),
        rowsPerSecond: Math.round(counts.sourceRows / Math.max(durationMs / 1000, 0.001)),
        rejectPath,
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    ok: true as const,
    idempotentReplay: false,
    db: dbIdentity.sanitized,
    fileSha256: sha256,
    nicheKey,
    lotKey,
    inventoryLotId: lotId,
    counts,
    setFingerprints,
    durationMs,
    peakRssMB: Math.round(peakRss / 1024 / 1024),
    rowsPerSecond: Math.round(counts.sourceRows / Math.max(durationMs / 1000, 0.001)),
    summaryPath,
    rejectPath,
  };
}

export async function reconcileAgedInventoryBulkSnapshot(
  args: Pick<AgedBulkCliArgs, "expectedFileSha256" | "expectedDbHost" | "workDir">,
  db: PrismaClient
) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_required");
  const dbIdentity = assertExpectedDbHost({
    databaseUrl,
    expectedDbHost: args.expectedDbHost,
  });

  const snapshot = await db.agedInventorySourceSnapshot.findUnique({
    where: { fileSha256: args.expectedFileSha256.toLowerCase() },
  });
  if (!snapshot) {
    // try as-provided casing
    const alt = await db.agedInventorySourceSnapshot.findFirst({
      where: { fileSha256: { equals: args.expectedFileSha256, mode: "insensitive" } },
    });
    if (!alt) throw new Error("snapshot_not_found");
    return reconcileFromSnapshot(alt, dbIdentity.sanitized, args.workDir, db);
  }
  return reconcileFromSnapshot(snapshot, dbIdentity.sanitized, args.workDir, db);
}

async function reconcileFromSnapshot(
  snapshot: {
    id: string;
    fileSha256: string;
    lotKey: string | null;
    inventoryLotId: string | null;
    totalSourceRows: number;
    parsedRows: number;
    acceptedRows: number;
    exactDuplicateRows: number;
    quarantinedRows: number;
    rejectedRows: number;
    importedRows: number;
    status: string;
    summaryJson: unknown;
  },
  sanitizedDb: string,
  workDir: string,
  db: PrismaClient
) {
  if (!snapshot.inventoryLotId) {
    throw new Error("snapshot_missing_lot");
  }
  const byStatus = await db.leadInventoryItem.groupBy({
    by: ["status"],
    where: { inventoryLotId: snapshot.inventoryLotId },
    _count: { _all: true },
  });
  const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  const itemCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const mismatch =
    itemCount !== snapshot.importedRows
      ? `imported_vs_items:${snapshot.importedRows}!=${itemCount}`
      : null;

  const report = {
    ok: !mismatch,
    db: sanitizedDb,
    snapshotId: snapshot.id,
    fileSha256: snapshot.fileSha256,
    status: snapshot.status,
    snapshotCounts: {
      sourceRows: snapshot.totalSourceRows,
      parsed: snapshot.parsedRows,
      accepted: snapshot.acceptedRows,
      exactDuplicates: snapshot.exactDuplicateRows,
      quarantined: snapshot.quarantinedRows,
      rejected: snapshot.rejectedRows,
      imported: snapshot.importedRows,
    },
    itemsByStatus: statusCounts,
    reserved: statusCounts.reserved ?? 0,
    committed: statusCounts.committed ?? 0,
    fulfilled: statusCounts.fulfilled ?? 0,
    available: statusCounts.available ?? 0,
    pendingReview: statusCounts.pending_review ?? 0,
    mismatch,
    summaryJson: snapshot.summaryJson,
  };

  await mkdir(workDir, { recursive: true });
  const out = path.join(workDir, `reconcile-${snapshot.fileSha256.slice(0, 12)}.json`);
  await writeFile(out, JSON.stringify(report, null, 2), "utf8");
  progressLog("reconcile", {
    ok: report.ok,
    imported: snapshot.importedRows,
    items: itemCount,
    pendingReview: report.pendingReview,
    available: report.available,
  });
  return { ...report, reportPath: out };
}
