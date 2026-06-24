import { BULK_IMPORT_INITIAL_CANARY_MAX_ROWS } from "@sa360/shared";
import { listBulkLeadImportRows } from "../../repositories/bulk-lead-import.repository.js";

export type BulkImportDeliveryRowCandidate = {
  id: string;
  rowNumber: number;
  deliveryStatus: string;
  duplicateStatus: string;
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  sourceLeadEventId: string | null;
  excluded: boolean;
  validationStatus: string;
  deliveryAttempts: number;
  errorCode: string | null;
  errorSummary: string | null;
};

export function isBulkImportRowDeliverableSimulated(
  row: BulkImportDeliveryRowCandidate
): boolean {
  return (
    !row.excluded &&
    row.validationStatus === "ready_for_simulation" &&
    row.deliveryStatus === "simulated" &&
    Boolean(row.sourceLeadEventId?.trim()) &&
    !row.ghlContactId?.trim() &&
    row.duplicateStatus !== "duplicate_review" &&
    row.duplicateStatus !== "blocked"
  );
}

export function isBulkImportRowRetryablePreGhlFailure(
  row: BulkImportDeliveryRowCandidate
): boolean {
  if (row.ghlContactId?.trim() || row.ghlOpportunityId?.trim()) return false;
  if (row.deliveryStatus !== "failed" || (row.deliveryAttempts ?? 0) < 1) return false;
  const code = row.errorCode?.toLowerCase() ?? "";
  const summary = row.errorSummary?.toLowerCase() ?? "";
  if (code.includes("ghl_contact") || code.includes("ghl_opportunity")) return false;
  if (summary.includes("ghl contact") || summary.includes("ghl opportunity")) return false;
  return true;
}

export function isBulkImportRowSelectableForLiveCanary(
  row: BulkImportDeliveryRowCandidate,
  _batch: { status: string; approvedAt?: Date | null }
): boolean {
  return isBulkImportRowDeliverableSimulated(row) || isBulkImportRowRetryablePreGhlFailure(row);
}

export function batchStatusAllowsLiveCanaryApproval(status: string): boolean {
  return (
    status === "simulation_complete" ||
    status === "completed" ||
    status === "partial_success" ||
    status === "failed"
  );
}

export async function listSelectableBulkImportDeliveryRows(
  batchId: string,
  batch: { status: string; approvedAt?: Date | null }
): Promise<BulkImportDeliveryRowCandidate[]> {
  const rows = await listBulkLeadImportRows(batchId);
  return rows
    .filter((row) => isBulkImportRowSelectableForLiveCanary(row, batch))
    .sort((a, b) => a.rowNumber - b.rowNumber);
}

export async function resolveBulkImportApprovalRowIds(input: {
  batchId: string;
  batch: { status: string; approvedAt?: Date | null };
  selectedRowIds?: string[];
  rowLimit?: number;
  initialCanaryDemoOnly?: boolean;
}): Promise<{
  rowIds: string[];
  rows: BulkImportDeliveryRowCandidate[];
  selectionMode: "explicit" | "default_first";
}> {
  const selectable = await listSelectableBulkImportDeliveryRows(input.batchId, input.batch);
  if (selectable.length === 0) {
    throw new Error("no_eligible_rows");
  }

  let maxWave = input.rowLimit ?? selectable.length;
  if (input.initialCanaryDemoOnly) {
    maxWave = Math.min(maxWave, BULK_IMPORT_INITIAL_CANARY_MAX_ROWS);
  }

  const explicit = input.selectedRowIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  if (explicit.length > 0) {
    const byId = new Map(selectable.map((row) => [row.id, row]));
    const rows: BulkImportDeliveryRowCandidate[] = [];
    for (const id of explicit) {
      const row = byId.get(id);
      if (!row) throw new Error("invalid_selected_row");
      rows.push(row);
    }
    if (rows.length > maxWave) throw new Error("row_limit_exceeded");
    return { rowIds: rows.map((r) => r.id), rows, selectionMode: "explicit" };
  }

  const rows = selectable.slice(0, maxWave);
  return {
    rowIds: rows.map((r) => r.id),
    rows,
    selectionMode: "default_first",
  };
}
