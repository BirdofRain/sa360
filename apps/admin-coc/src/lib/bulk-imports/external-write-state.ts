export type BulkImportExternalWriteState =
  | "not_normalized"
  | "normalized"
  | "simulated"
  | "approved"
  | "delivering"
  | "completed";

export function deriveBulkImportExternalWriteState(batch: {
  status: string;
  rows?: Array<{ sourceLeadEventId?: string | null; deliveryStatus?: string }>;
}): BulkImportExternalWriteState {
  const status = batch.status;
  if (status === "completed" || status === "partial_success") return "completed";
  if (status === "delivery_running") return "delivering";
  if (status === "approved_for_delivery") return "approved";
  if (status === "simulation_complete" || status === "simulation_running") return "simulated";
  const hasSourceEvents = (batch.rows ?? []).some((r) => Boolean(r.sourceLeadEventId));
  if (hasSourceEvents || status === "ready_for_simulation" || status === "ready_for_review") {
    return "normalized";
  }
  return "not_normalized";
}

export const EXTERNAL_WRITE_STATE_LABELS: Record<BulkImportExternalWriteState, string> = {
  not_normalized: "Not normalized — SA360 batch rows only",
  normalized: "Normalized — Source Intake records created; no GHL writes",
  simulated: "Simulated — internal delivery plans only; no GHL writes",
  approved: "Approved — delivery queued",
  delivering: "Delivering — GHL writes in progress",
  completed: "Completed — delivery results available",
};
