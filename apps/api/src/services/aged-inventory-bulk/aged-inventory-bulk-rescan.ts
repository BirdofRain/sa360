/**
 * PII-free resume reconstruction: re-classify source rows 1..endExclusive through the
 * same normalizer used by uninterrupted import, rebuilding identity index + aggregate
 * counts + rolling fingerprints. No contact fields are persisted.
 */
import type { LeadInventoryAgeBand } from "../lead-inventory/lead-inventory.constants.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import {
  adaptMasterRow,
  assertMasterHeaders,
} from "./aged-inventory-bulk-adapters.js";
import {
  RollingSetFingerprint,
  emptyCheckpointCounts,
  type AgedBulkCheckpointCounts,
} from "./aged-inventory-bulk-checkpoint.js";
import {
  createIdentityConflictIndex,
  isAcceptDisposition,
  normalizeMasterRow,
  type IdentityConflictIndex,
} from "./aged-inventory-bulk-normalize.js";
import { streamCsvFile } from "./aged-inventory-bulk-stream.js";
import type { AgedBulkSourceFormat } from "./aged-inventory-bulk.types.js";

export type RescanResult = {
  identityIndex: IdentityConflictIndex;
  counts: AgedBulkCheckpointCounts;
  byState: Record<string, number>;
  byAgeBand: Record<string, number>;
  acceptedFp: RollingSetFingerprint;
  quarantinedFp: RollingSetFingerprint;
  rejectedFp: RollingSetFingerprint;
  rowsScanned: number;
};

function bumpCounts(
  counts: AgedBulkCheckpointCounts,
  disposition: string,
  extras: { statusRaw: string | null; usedByPresent: boolean }
) {
  counts.parsedRows += 1;
  counts.byDisposition[disposition] = (counts.byDisposition[disposition] ?? 0) + 1;
  if (extras.statusRaw?.toUpperCase() === "PULLED") counts.pulledStatusRows += 1;
  if (extras.usedByPresent) counts.usedByPresentRows += 1;

  if (disposition === "accept" || disposition === "email_issue_retained") {
    counts.acceptedRows += 1;
    if (disposition === "email_issue_retained") counts.emailIssueRetainedRows += 1;
  } else if (
    disposition === "exact_source_duplicate" ||
    disposition === "identity_duplicate_same_date" ||
    disposition === "already_inventory"
  ) {
    counts.exactDuplicateRows += 1;
  } else if (disposition === "quarantine_identity_conflict") {
    counts.quarantinedRows += 1;
  } else {
    counts.rejectedRows += 1;
  }
}

function emptyRescan(resultBase: {
  identityIndex: IdentityConflictIndex;
  counts: AgedBulkCheckpointCounts;
  acceptedFp: RollingSetFingerprint;
  quarantinedFp: RollingSetFingerprint;
  rejectedFp: RollingSetFingerprint;
}): RescanResult {
  return {
    ...resultBase,
    byState: {},
    byAgeBand: {},
    rowsScanned: 0,
  };
}

/**
 * Re-classify rows [1, endExclusive) to reconstruct deterministic import state.
 * endExclusive is the 1-based nextRowNumber from the checkpoint (exclusive upper bound).
 */
export async function rescanSourceRowsForResume(input: {
  filePath: string;
  sourceFormat: AgedBulkSourceFormat;
  nicheKey: string;
  endExclusive: number;
  evaluatedAt: Date;
  ageBands: LeadInventoryAgeBand[];
}): Promise<RescanResult> {
  if (input.endExclusive < 1) throw new Error("rescan_end_exclusive_invalid");
  const identityIndex = createIdentityConflictIndex();
  const counts = emptyCheckpointCounts();
  const acceptedFp = new RollingSetFingerprint();
  const quarantinedFp = new RollingSetFingerprint();
  const rejectedFp = new RollingSetFingerprint();
  const byState: Record<string, number> = {};
  const byAgeBand: Record<string, number> = {};
  let headerIndex: Map<string, number> | null = null;
  let rowsScanned = 0;

  if (input.endExclusive <= 1) {
    return emptyRescan({ identityIndex, counts, acceptedFp, quarantinedFp, rejectedFp });
  }

  await streamCsvFile(input.filePath, {
    startRowNumber: 1,
    endRowNumberExclusive: input.endExclusive,
    onHeader: (headers) => {
      const asserted = assertMasterHeaders(headers, input.sourceFormat);
      if (!asserted.ok) throw new Error(asserted.error);
      headerIndex = asserted.index;
    },
    onRow: async (rowNumber, cols) => {
      if (!headerIndex) throw new Error("missing_header_index");
      rowsScanned += 1;
      const raw = adaptMasterRow({
        rowNumber,
        cols,
        index: headerIndex,
        sourceFormat: input.sourceFormat,
      });
      const normalized = normalizeMasterRow({
        raw,
        nicheKey: input.nicheKey,
        identityIndex,
        evaluatedAt: input.evaluatedAt,
      });
      bumpCounts(counts, normalized.disposition, {
        statusRaw: normalized.statusRaw,
        usedByPresent: normalized.usedByPresent,
      });
      if (isAcceptDisposition(normalized.disposition)) {
        acceptedFp.update(normalized.sourceLeadId);
        if (normalized.state) byState[normalized.state] = (byState[normalized.state] ?? 0) + 1;
        const ageDays = calculateInventoryAgeDays(normalized.generatedAt, input.evaluatedAt);
        const ageBandKey = resolveAgeBandKey(ageDays, input.ageBands);
        if (ageBandKey) byAgeBand[ageBandKey] = (byAgeBand[ageBandKey] ?? 0) + 1;
      } else if (normalized.disposition === "quarantine_identity_conflict") {
        quarantinedFp.update(normalized.sourceLeadId);
      } else if (
        normalized.disposition !== "exact_source_duplicate" &&
        normalized.disposition !== "identity_duplicate_same_date" &&
        normalized.disposition !== "already_inventory"
      ) {
        rejectedFp.update(normalized.sourceLeadId);
      }
    },
  });

  return {
    identityIndex,
    counts,
    byState,
    byAgeBand,
    acceptedFp,
    quarantinedFp,
    rejectedFp,
    rowsScanned,
  };
}
