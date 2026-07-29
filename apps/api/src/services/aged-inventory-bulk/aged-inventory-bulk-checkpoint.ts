import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Versioned durable checkpoint for aged bulk import resume (no PII). */
export const AGED_BULK_CHECKPOINT_VERSION = "aged-bulk-checkpoint-v2" as const;
export const AGED_BULK_NORMALIZER_VERSION = "aged-bulk-normalize-v1" as const;

export type AgedBulkCheckpointCounts = {
  parsedRows: number;
  acceptedRows: number;
  exactDuplicateRows: number;
  quarantinedRows: number;
  rejectedRows: number;
  importedRows: number;
  emailIssueRetainedRows: number;
  pulledStatusRows: number;
  usedByPresentRows: number;
  byDisposition: Record<string, number>;
};

export type AgedBulkCheckpointV2 = {
  version: typeof AGED_BULK_CHECKPOINT_VERSION;
  normalizerVersion: typeof AGED_BULK_NORMALIZER_VERSION;
  fileSha256: string;
  sourceFormat: string;
  defaultNicheKey: string;
  lotKey: string;
  importRequestId: string;
  /** ISO timestamp used for date/age evaluation — must be reused on resume. */
  evaluatedAtIso: string;
  nextRowNumber: number;
  batchesCompleted: number;
  /** Rolling SHA-256 hex of accepted sourceLeadIds in source-row order (not raw IDs). */
  acceptedSetRollingSha256: string;
  quarantinedSetRollingSha256: string;
  rejectedSetRollingSha256: string;
  counts: AgedBulkCheckpointCounts;
  updatedAt: string;
};

export function emptyCheckpointCounts(): AgedBulkCheckpointCounts {
  return {
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
  };
}

/** Order-preserving rolling hash — feed each member id once in source-row order. */
export class RollingSetFingerprint {
  private hash = createHash("sha256");
  private count = 0;

  update(memberId: string): void {
    this.hash.update(memberId);
    this.hash.update("\n");
    this.count += 1;
  }

  digest(): string {
    // Clone via digest of current state by using a copy of the hex so far is not possible
    // with Node Hash; we keep a parallel hex by re-creating from stored hex+count only at
    // checkpoint boundaries. For live use, expose hex of current hasher via copy.
    return this.hash.copy().digest("hex");
  }

  get size(): number {
    return this.count;
  }

  static fromDigest(hex: string, count: number): RollingSetFingerprint {
    const fp = new RollingSetFingerprint();
    // Restore is only used for validation of stored digest equality after rescan;
    // live resume always rescan-rebuilds fingerprints from source rows.
    void hex;
    void count;
    return fp;
  }
}

export function checkpointPath(workDir: string, fileSha256: string): string {
  return path.join(workDir, `checkpoint-${fileSha256.slice(0, 12)}.v2.json`);
}

export async function writeAgedBulkCheckpoint(
  workDir: string,
  checkpoint: AgedBulkCheckpointV2
): Promise<string> {
  if (checkpoint.version !== AGED_BULK_CHECKPOINT_VERSION) {
    throw new Error("checkpoint_version_invalid");
  }
  await mkdir(workDir, { recursive: true });
  const p = checkpointPath(workDir, checkpoint.fileSha256);
  await writeFile(p, JSON.stringify(checkpoint, null, 2), "utf8");
  return p;
}

export async function loadAgedBulkCheckpoint(
  workDir: string,
  fileSha256: string
): Promise<AgedBulkCheckpointV2 | null> {
  const p = checkpointPath(workDir, fileSha256);
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as AgedBulkCheckpointV2;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw new Error("checkpoint_unreadable");
  }
}

/** Parse DB checkpointJson when workDir file is absent. Rejects non-v2 payloads. */
export function parseDbCheckpointJson(value: unknown): AgedBulkCheckpointV2 | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.version !== AGED_BULK_CHECKPOINT_VERSION) return null;
  return value as AgedBulkCheckpointV2;
}

/**
 * Fail-closed validation before resume. Does not trust incomplete or foreign checkpoints.
 */
export function assertCheckpointUsableForResume(input: {
  checkpoint: AgedBulkCheckpointV2 | null;
  fileSha256: string;
  sourceFormat: string;
  defaultNicheKey: string;
  lotKey: string;
  importRequestId: string;
  dbNextRowNumber: number;
}): AgedBulkCheckpointV2 {
  const cp = input.checkpoint;
  if (!cp) throw new Error("checkpoint_missing");
  if (cp.version !== AGED_BULK_CHECKPOINT_VERSION) {
    throw new Error(`checkpoint_version_mismatch:got=${cp.version}`);
  }
  if (cp.normalizerVersion !== AGED_BULK_NORMALIZER_VERSION) {
    throw new Error(`checkpoint_normalizer_mismatch:got=${cp.normalizerVersion}`);
  }
  if (cp.fileSha256.toLowerCase() !== input.fileSha256.toLowerCase()) {
    throw new Error("checkpoint_file_sha256_mismatch");
  }
  if (cp.sourceFormat !== input.sourceFormat) {
    throw new Error("checkpoint_source_format_mismatch");
  }
  if (cp.defaultNicheKey !== input.defaultNicheKey) {
    throw new Error("checkpoint_niche_mismatch");
  }
  if (cp.lotKey !== input.lotKey) {
    throw new Error("checkpoint_lot_key_mismatch");
  }
  if (cp.importRequestId !== input.importRequestId) {
    throw new Error("checkpoint_import_request_id_mismatch");
  }
  if (!Number.isInteger(cp.nextRowNumber) || cp.nextRowNumber < 1) {
    throw new Error("checkpoint_next_row_invalid");
  }
  if (cp.nextRowNumber !== input.dbNextRowNumber) {
    throw new Error(
      `checkpoint_db_next_row_mismatch:checkpoint=${cp.nextRowNumber};db=${input.dbNextRowNumber}`
    );
  }
  if (!cp.evaluatedAtIso || Number.isNaN(Date.parse(cp.evaluatedAtIso))) {
    throw new Error("checkpoint_evaluated_at_invalid");
  }
  if (!cp.counts || typeof cp.counts !== "object") {
    throw new Error("checkpoint_counts_missing");
  }
  if (
    !cp.acceptedSetRollingSha256 ||
    !/^[a-f0-9]{64}$/i.test(cp.acceptedSetRollingSha256)
  ) {
    throw new Error("checkpoint_accepted_fingerprint_invalid");
  }
  return cp;
}

export function buildCheckpointPayload(input: {
  fileSha256: string;
  sourceFormat: string;
  defaultNicheKey: string;
  lotKey: string;
  importRequestId: string;
  evaluatedAtIso: string;
  nextRowNumber: number;
  batchesCompleted: number;
  acceptedSetRollingSha256: string;
  quarantinedSetRollingSha256: string;
  rejectedSetRollingSha256: string;
  counts: AgedBulkCheckpointCounts;
}): AgedBulkCheckpointV2 {
  return {
    version: AGED_BULK_CHECKPOINT_VERSION,
    normalizerVersion: AGED_BULK_NORMALIZER_VERSION,
    fileSha256: input.fileSha256,
    sourceFormat: input.sourceFormat,
    defaultNicheKey: input.defaultNicheKey,
    lotKey: input.lotKey,
    importRequestId: input.importRequestId,
    evaluatedAtIso: input.evaluatedAtIso,
    nextRowNumber: input.nextRowNumber,
    batchesCompleted: input.batchesCompleted,
    acceptedSetRollingSha256: input.acceptedSetRollingSha256,
    quarantinedSetRollingSha256: input.quarantinedSetRollingSha256,
    rejectedSetRollingSha256: input.rejectedSetRollingSha256,
    counts: input.counts,
    updatedAt: new Date().toISOString(),
  };
}
