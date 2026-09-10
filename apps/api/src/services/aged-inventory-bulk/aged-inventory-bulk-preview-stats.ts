import { isAcceptDisposition } from "./aged-inventory-bulk-normalize.js";
import type {
  AgedBulkAggregateCounts,
  AgedBulkNormalizedRow,
  AgedBulkPreviewReport,
  AgedBulkRowDisposition,
} from "./aged-inventory-bulk.types.js";

const REJECT_DISPOSITIONS = new Set<AgedBulkRowDisposition>([
  "reject_no_identity",
  "reject_invalid_state",
  "reject_invalid_date",
  "reject_invalid_name",
  "reject_missing_source_lead_id",
  "reject_future_date",
  "reject_niche",
]);

export function emptyAgedBulkCounts(): AgedBulkAggregateCounts {
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
    byBlocker: {},
    earliestGeneratedAt: null,
    latestGeneratedAt: null,
  };
}

export function accumulateAgedBulkRow(
  counts: AgedBulkAggregateCounts,
  row: AgedBulkNormalizedRow,
  ageBandKey: string | null
): void {
  counts.parsedRows += 1;
  counts.byDisposition[row.disposition] = (counts.byDisposition[row.disposition] ?? 0) + 1;
  for (const code of row.blockerCodes) {
    counts.byBlocker[code] = (counts.byBlocker[code] ?? 0) + 1;
  }
  if (row.statusRaw?.toUpperCase() === "PULLED") counts.pulledStatusRows += 1;
  if (row.usedByPresent) counts.usedByPresentRows += 1;

  if (row.generatedAt.getTime() > 0) {
    const iso = row.generatedAt.toISOString();
    if (!counts.earliestGeneratedAt || iso < counts.earliestGeneratedAt) {
      counts.earliestGeneratedAt = iso;
    }
    if (!counts.latestGeneratedAt || iso > counts.latestGeneratedAt) {
      counts.latestGeneratedAt = iso;
    }
  }

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

export function buildAgedBulkPreviewReport(counts: AgedBulkAggregateCounts): AgedBulkPreviewReport {
  const rejectionReasons: Record<string, number> = {};
  for (const [disposition, n] of Object.entries(counts.byDisposition)) {
    if (REJECT_DISPOSITIONS.has(disposition as AgedBulkRowDisposition) && n > 0) {
      rejectionReasons[disposition] = n;
    }
  }
  for (const [code, n] of Object.entries(counts.byBlocker)) {
    if (n > 0 && !(code in rejectionReasons)) {
      rejectionReasons[code] = n;
    }
  }

  return {
    totalCsvRows: counts.sourceRows,
    parseableRows: counts.acceptedRows + counts.exactDuplicateRows + counts.quarantinedRows,
    rejectedRows: counts.rejectedRows,
    rejectionReasons,
    duplicateCandidates: counts.exactDuplicateRows,
    byState: { ...counts.byState },
    byAgeBand: { ...counts.byAgeBand },
    earliestCreated: counts.earliestGeneratedAt,
    latestCreated: counts.latestGeneratedAt,
  };
}
