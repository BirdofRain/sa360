import type { BulkImportReviewRow } from "@/components/bulk-imports/bulk-import-review-table";
import type { BulkImportLiveDeliverySnapshot } from "@/components/bulk-imports/bulk-import-monitor-panel";

export type BulkImportCanaryRowStatus =
  | "selectable"
  | "delivered"
  | "failed_retryable"
  | "failed_blocked"
  | "unmatched"
  | "not_simulated";

export function resolveBulkImportCanaryRowStatus(
  row: BulkImportReviewRow,
  routingMatched?: boolean
): BulkImportCanaryRowStatus {
  if (row.deliveryStatus === "delivered" || row.ghlContactId) return "delivered";
  if (row.deliveryStatus === "simulated" && !row.excluded) {
    return routingMatched === false ? "unmatched" : "selectable";
  }
  if (row.deliveryStatus === "failed" && (row.deliveryAttempts ?? 0) > 0) {
    if (row.ghlContactId || row.ghlOpportunityId) return "failed_blocked";
    return "failed_retryable";
  }
  return "not_simulated";
}

export function defaultSelectedCanaryRowId(
  rows: BulkImportReviewRow[],
  rowChecks: Array<{ rowId: string; matched: boolean }>,
  maxSelectable: number
): string | null {
  const matchedIds = new Set(rowChecks.filter((row) => row.matched).map((row) => row.rowId));
  const candidate = rows
    .filter((row) => {
      const status = resolveBulkImportCanaryRowStatus(row, matchedIds.has(row.id));
      return status === "selectable" || status === "failed_retryable";
    })
    .sort((a, b) => a.rowNumber - b.rowNumber)[0];
  if (!candidate || maxSelectable < 1) return null;
  return candidate.id;
}

export function nextUndeliveredCanaryRowId(
  rows: BulkImportReviewRow[],
  rowChecks: Array<{ rowId: string; matched: boolean }>,
  currentSelectedId: string | null
): string | null {
  const matchedIds = new Set(rowChecks.filter((row) => row.matched).map((row) => row.rowId));
  const candidates = rows
    .filter((row) => {
      const status = resolveBulkImportCanaryRowStatus(row, matchedIds.has(row.id));
      return status === "selectable" || status === "failed_retryable";
    })
    .sort((a, b) => a.rowNumber - b.rowNumber);
  if (candidates.length === 0) return null;
  if (!currentSelectedId) return candidates[0]!.id;
  const idx = candidates.findIndex((row) => row.id === currentSelectedId);
  if (idx < 0) return candidates[0]!.id;
  return candidates[idx + 1]?.id ?? candidates[0]!.id;
}

export type { BulkImportLiveDeliverySnapshot };
