import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps";

const LIVE_APPROVAL_STATUSES = new Set([
  "approved_for_delivery",
  "delivery_running",
  "partial_success",
  "completed",
]);

export const SIMULATION_LOCKED_MESSAGE =
  "This batch has already been approved for live delivery. Simulation is locked. Reset to Review to clear approval and simulate again.";

export const SIMULATION_RESET_DELIVERED_BLOCK_MESSAGE =
  "This batch has delivered rows in GHL. Clearing live approval is blocked to protect delivered contacts. Review Results for delivery outcomes.";

export function batchHasLiveDeliveryApproval(batch: {
  status: string;
  approvedAt?: string | Date | null;
}): boolean {
  const approvedAt =
    batch.approvedAt instanceof Date
      ? batch.approvedAt.toISOString()
      : batch.approvedAt?.trim();
  return Boolean(approvedAt) || LIVE_APPROVAL_STATUSES.has(batch.status);
}

export function isSimulationLocked(
  batch: BulkImportBatchState & { approvedAt?: string | Date | null },
  _summary?: BulkImportSummary
): boolean {
  return batchHasLiveDeliveryApproval(batch);
}

export function resolveSimulationResetEligibility(summary: BulkImportSummary): {
  allowed: boolean;
  blockMessage: string | null;
} {
  const deliveredRows = Number(summary.deliveredRows ?? 0);
  if (deliveredRows > 0) {
    return { allowed: false, blockMessage: SIMULATION_RESET_DELIVERED_BLOCK_MESSAGE };
  }
  return { allowed: true, blockMessage: null };
}
