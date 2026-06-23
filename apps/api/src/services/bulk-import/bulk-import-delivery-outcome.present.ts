export type BulkImportRowFailureSummary = {
  rowNumber: number;
  rowId: string;
  errorCode: string | null;
  errorSummary: string;
  operatorMessage: string;
};

export type BulkImportDeliveryOutcome =
  | "pending"
  | "running"
  | "delivered"
  | "failed"
  | "partial";

export const BULK_IMPORT_ROUTING_FAILURE_OPERATOR_MESSAGE =
  "No active routing rule matched attribution.";

export function normalizeBulkImportPreGhlFailureReason(
  errorSummary: string | null | undefined
): string {
  const summary = errorSummary?.trim() ?? "";
  if (!summary) return "Delivery failed before GHL write.";
  if (summary.includes("No active routing rule matched")) {
    return BULK_IMPORT_ROUTING_FAILURE_OPERATOR_MESSAGE;
  }
  if (summary.includes("No routing rule matched")) {
    return BULK_IMPORT_ROUTING_FAILURE_OPERATOR_MESSAGE;
  }
  if (summary.includes("No matched destination")) {
    return "No matched destination — routing rule required before live delivery.";
  }
  return summary;
}

export function formatBulkImportPreGhlFailureBanner(input: {
  failedCount: number;
  primaryReason?: string | null;
}): string | null {
  if (input.failedCount <= 0) return null;
  const reason = normalizeBulkImportPreGhlFailureReason(input.primaryReason);
  const noun = input.failedCount === 1 ? "row" : "rows";
  return `${input.failedCount} ${noun} failed before GHL write: ${reason}`;
}

export function summarizeBulkImportRowFailures(
  rows: Array<{
    id: string;
    rowNumber: number;
    deliveryStatus: string;
    deliveryAttempts?: number | null;
    errorCode?: string | null;
    errorSummary?: string | null;
  }>
): BulkImportRowFailureSummary[] {
  return rows
    .filter(
      (row) =>
        row.deliveryStatus === "failed" && (row.deliveryAttempts ?? 0) > 0
    )
    .map((row) => ({
      rowId: row.id,
      rowNumber: row.rowNumber,
      errorCode: row.errorCode ?? null,
      errorSummary: row.errorSummary?.trim() || "Delivery failed.",
      operatorMessage: normalizeBulkImportPreGhlFailureReason(row.errorSummary),
    }));
}

export function resolveBulkImportWorkerJobState(
  queueJobs: Array<{ state: string }>
): string {
  if (queueJobs.length === 0) return "none";
  const states = queueJobs.map((job) => job.state);
  if (states.every((state) => state === "completed")) return "completed";
  if (states.some((state) => state === "failed")) return "failed";
  if (states.some((state) => state === "active")) return "active";
  if (states.some((state) => state === "waiting" || state === "delayed")) {
    return "queued";
  }
  return states[0] ?? "unknown";
}

export function resolveBulkImportDeliveryOutcome(input: {
  batchStatus: string;
  rowsDelivered: number;
  rowsFailed: number;
  approvedRowCount: number;
}): BulkImportDeliveryOutcome {
  const status = input.batchStatus.toLowerCase();
  if (status === "delivery_running" || status === "approved_for_delivery") {
    return input.rowsDelivered > 0 || input.rowsFailed > 0 ? "running" : "pending";
  }
  if (status === "completed" || status === "partial_success") {
    if (input.rowsFailed > 0 && input.rowsDelivered > 0) return "partial";
    if (input.rowsFailed > 0) return "failed";
    if (input.rowsDelivered > 0) return "delivered";
  }
  if (status === "failed") return "failed";
  if (input.rowsFailed > 0 && input.rowsDelivered === 0) return "failed";
  if (input.rowsDelivered > 0 && input.rowsFailed > 0) return "partial";
  if (input.rowsDelivered > 0) return "delivered";
  if (input.approvedRowCount > 0) return "pending";
  return "pending";
}
