import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AGED_INVENTORY_BULK_DEFAULT_BATCH_SIZE,
  AGED_INVENTORY_BULK_MAX_BATCH_SIZE,
  AGED_INVENTORY_BULK_SOURCE_LANE,
  AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION,
} from "@sa360/shared";

import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { buildAgedInventoryLeadUid } from "../aged-inventory-import/aged-inventory-import-classify.service.js";
import {
  adaptMasterRow,
  assertMasterHeaders,
  resolveDefaultNiche,
} from "./aged-inventory-bulk-adapters.js";
import { assertExpectedDbHost } from "./aged-inventory-bulk-db-guard.js";
import {
  createIdentityConflictIndex,
  isAcceptDisposition,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
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

async function persistCheckpoint(
  workDir: string,
  fileSha256: string,
  checkpoint: Record<string, unknown>
) {
  await mkdir(workDir, { recursive: true });
  const p = path.join(workDir, `checkpoint-${fileSha256.slice(0, 12)}.json`);
  await writeFile(p, JSON.stringify(checkpoint, null, 2), "utf8");
  return p;
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
          const normalizedPayloadJson = {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone_e164: row.phoneE164,
            state: row.state,
            generated_at: row.generatedAt.toISOString(),
            niche_key: row.nicheKey,
            campaign_name: row.campaignName,
            status_raw: row.statusRaw,
            used_by_present: row.usedByPresent,
            email_issue: row.emailIssue,
          } satisfies Prisma.JsonObject;

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
              rawPayloadJson: {
                importRequestId: input.importRequestId,
                rowNumber: row.rowNumber,
              },
              normalizedPayloadJson,
              enrichmentMetadataJson: {
                sourceLane: input.sourceLane,
                generatedAt: row.generatedAt.toISOString(),
                importClass: "aged_inventory_bulk_csv",
                disposition: row.disposition,
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
  const evaluatedAt = new Date();
  const identityIndex = createIdentityConflictIndex();
  const counts = emptyCounts();
  // Resume must only carry forward importedRows. Disposition tallies are recomputed
  // for rows processed in this run, then replaced at completion by a full-file recount
  // when a prior preview summary exists (avoids double-counting across resume).
  const priorPreviewSummary =
    existingSnapshot?.summaryJson && typeof existingSnapshot.summaryJson === "object"
      ? (existingSnapshot.summaryJson as Record<string, unknown>)
      : null;
  if (args.mode === "resume" && existingSnapshot) {
    counts.importedRows = existingSnapshot.importedRows;
  }
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
  const startRowNumber =
    args.mode === "resume" ? Math.max(1, existingSnapshot?.nextRowNumber ?? 1) : 1;
  const writing = args.mode === "commit" || args.mode === "resume";
  const started = Date.now();
  let peakRss = process.memoryUsage().rss;

  // Rebuild in-file identity maps from already-imported events so resume does not
  // weaken conflict detection for later rows.
  if (writing && existingSnapshot?.inventoryLotId) {
    const priorEvents = await db.sourceLeadEvent.findMany({
      where: {
        sourceRouteKey: `AGED_BULK::${lotKey}`,
      },
      select: { sourceLeadId: true, normalizedPayloadJson: true },
    });
    for (const ev of priorEvents) {
      identityIndex.seenSourceIds.add(ev.sourceLeadId);
      const payload =
        ev.normalizedPayloadJson && typeof ev.normalizedPayloadJson === "object"
          ? (ev.normalizedPayloadJson as Record<string, unknown>)
          : null;
      const phone = typeof payload?.phone_e164 === "string" ? payload.phone_e164 : null;
      const email = typeof payload?.email === "string" ? payload.email : null;
      if (phone && email) {
        identityIndex.phoneToEmail.set(phone, email);
        identityIndex.emailToPhone.set(email, phone);
      }
    }
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
      counts.exactDuplicateRows += result.skippedExisting;
      const lastRow = batch[batch.length - 1]!.rowNumber;
      await db.agedInventorySourceSnapshot.update({
        where: { fileSha256: sha256 },
        data: {
          nextRowNumber: lastRow + 1,
          batchesCompleted: { increment: 1 },
          importedRows: counts.importedRows,
          acceptedRows: counts.acceptedRows,
          exactDuplicateRows: counts.exactDuplicateRows,
          quarantinedRows: counts.quarantinedRows,
          rejectedRows: counts.rejectedRows,
          parsedRows: counts.parsedRows,
          totalSourceRows: counts.sourceRows,
          checkpointJson: {
            lastRowNumber: lastRow,
            importedRows: counts.importedRows,
            at: new Date().toISOString(),
          },
        },
      });
      await persistCheckpoint(args.workDir, sha256, {
        fileSha256: sha256,
        nextRowNumber: lastRow + 1,
        importedRows: counts.importedRows,
        lotKey,
        lotId,
      });
      progressLog("batch_committed", {
        lastRowNumber: lastRow,
        batchSize: batch.length,
        importedRows: counts.importedRows,
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      });
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
        throw new Error(`interrupted_after_row:${rowNumber}`);
      }
    },
  });

  counts.sourceRows = streamResult.dataRows;
  await flush();

  const durationMs = Date.now() - started;
  const rejectPath = await writeRejectAggregate(args.workDir, sha256, counts);

  // Prefer full-file disposition tallies from preview when resuming mid-file.
  const finalDisposition =
    args.mode === "resume" &&
    priorPreviewSummary?.byDisposition &&
    typeof priorPreviewSummary.byDisposition === "object"
      ? {
          acceptedRows: Number(priorPreviewSummary.acceptedRows ?? counts.acceptedRows) ||
            Object.entries(priorPreviewSummary.byDisposition as Record<string, number>)
              .filter(([k]) => k === "accept" || k === "email_issue_retained")
              .reduce((a, [, v]) => a + v, 0),
          exactDuplicateRows:
            Number(
              (priorPreviewSummary.byDisposition as Record<string, number>).exact_source_duplicate ??
                counts.exactDuplicateRows
            ) || counts.exactDuplicateRows,
          quarantinedRows:
            Number(
              (priorPreviewSummary.byDisposition as Record<string, number>)
                .quarantine_identity_conflict ?? counts.quarantinedRows
            ) || counts.quarantinedRows,
          rejectedRows: counts.rejectedRows,
          byDisposition: priorPreviewSummary.byDisposition as Record<string, number>,
          byState: (priorPreviewSummary.byState as Record<string, number>) ?? counts.byState,
          byAgeBand: (priorPreviewSummary.byAgeBand as Record<string, number>) ?? counts.byAgeBand,
          pulledStatusRows:
            Number(priorPreviewSummary.pulledStatusRows ?? counts.pulledStatusRows) ||
            counts.pulledStatusRows,
          usedByPresentRows:
            Number(priorPreviewSummary.usedByPresentRows ?? counts.usedByPresentRows) ||
            counts.usedByPresentRows,
          emailIssueRetainedRows:
            Number(priorPreviewSummary.emailIssueRetainedRows ?? counts.emailIssueRetainedRows) ||
            counts.emailIssueRetainedRows,
        }
      : {
          acceptedRows: counts.acceptedRows,
          exactDuplicateRows: counts.exactDuplicateRows,
          quarantinedRows: counts.quarantinedRows,
          rejectedRows: counts.rejectedRows,
          byDisposition: counts.byDisposition,
          byState: counts.byState,
          byAgeBand: counts.byAgeBand,
          pulledStatusRows: counts.pulledStatusRows,
          usedByPresentRows: counts.usedByPresentRows,
          emailIssueRetainedRows: counts.emailIssueRetainedRows,
        };

  // When resume used preview tallies, derive rejected from source - accepted - dups - quarantine
  if (args.mode === "resume" && priorPreviewSummary?.byDisposition) {
    const bd = priorPreviewSummary.byDisposition as Record<string, number>;
    finalDisposition.acceptedRows = (bd.accept ?? 0) + (bd.email_issue_retained ?? 0);
    finalDisposition.exactDuplicateRows =
      (bd.exact_source_duplicate ?? 0) +
      (bd.identity_duplicate_same_date ?? 0) +
      (bd.already_inventory ?? 0);
    finalDisposition.quarantinedRows = bd.quarantine_identity_conflict ?? 0;
    finalDisposition.rejectedRows =
      counts.sourceRows -
      finalDisposition.acceptedRows -
      finalDisposition.exactDuplicateRows -
      finalDisposition.quarantinedRows;
    if (finalDisposition.rejectedRows < 0) finalDisposition.rejectedRows = 0;
  }

  counts.acceptedRows = finalDisposition.acceptedRows;
  counts.exactDuplicateRows = finalDisposition.exactDuplicateRows;
  counts.quarantinedRows = finalDisposition.quarantinedRows;
  counts.rejectedRows = finalDisposition.rejectedRows;
  counts.byDisposition = finalDisposition.byDisposition;
  counts.byState = finalDisposition.byState;
  counts.byAgeBand = finalDisposition.byAgeBand;
  counts.pulledStatusRows = finalDisposition.pulledStatusRows;
  counts.usedByPresentRows = finalDisposition.usedByPresentRows;
  counts.emailIssueRetainedRows = finalDisposition.emailIssueRetainedRows;
  counts.parsedRows = counts.sourceRows;

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
          resumeUsedPreviewTallies: args.mode === "resume",
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
