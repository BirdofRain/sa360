import type { BulkImportWizardStep } from "./types";

export type BulkImportSummary = {
  totalRows?: number;
  validIdentity?: number;
  blockedIdentity?: number;
  duplicateReview?: number;
  mappingRequired?: number;
  eligibleForSimulation?: number;
  excluded?: number;
  simulatedRows?: number;
  deliveredRows?: number;
  failedRows?: number;
  batchStatus?: string;
  wizardStep?: string;
};

export type BulkImportBatchState = {
  status: string;
  mappingJson?: Record<string, string>;
  destinationClientAccountId?: string | null;
  destinationLocationIdGhl?: string | null;
  importOptionsJson?: Record<string, unknown> | null;
  wizardStepJson?: { step?: string; missingRequired?: string[] } | null;
  simulatedRows?: number;
};

const MONITOR_STATUSES = new Set([
  "approved_for_delivery",
  "delivery_running",
  "paused",
  "partial_success",
  "completed",
  "failed",
]);

const RESULTS_STATUSES = new Set(["partial_success", "completed", "failed"]);

export function deriveWizardStep(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): BulkImportWizardStep {
  const wizardStep = batch.wizardStepJson?.step ?? summary.wizardStep;
  if (wizardStep === "monitor" || MONITOR_STATUSES.has(batch.status)) {
    if (RESULTS_STATUSES.has(batch.status) || (summary.deliveredRows ?? 0) > 0) {
      return "results";
    }
    return "monitor";
  }
  if (batch.status === "simulation_complete" || wizardStep === "approve") return "approve";
  if (
    batch.status === "simulation_running" ||
    batch.status === "ready_for_simulation" ||
    wizardStep === "simulate"
  ) {
    return "simulate";
  }
  if (batch.destinationClientAccountId && batch.destinationLocationIdGhl) {
    if ((summary.eligibleForSimulation ?? 0) > 0 && batch.status !== "ready_for_review") {
      return wizardStep === "review" ? "review" : "simulate";
    }
    return "review";
  }
  const missing = batch.wizardStepJson?.missingRequired ?? [];
  if (missing.length > 0 || batch.status === "mapping_required") return "map";
  if (wizardStep === "destination" || !batch.destinationClientAccountId) return "destination";
  return (wizardStep as BulkImportWizardStep) ?? "map";
}

export function canAccessWizardStep(
  target: BulkImportWizardStep,
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): boolean {
  const current = deriveWizardStep(batch, summary);
  const order: BulkImportWizardStep[] = [
    "upload",
    "map",
    "destination",
    "review",
    "simulate",
    "approve",
    "monitor",
    "results",
  ];
  const targetIdx = order.indexOf(target);
  const currentIdx = order.indexOf(current);
  if (targetIdx < 0 || currentIdx < 0) return false;
  return targetIdx <= currentIdx;
}

export function canProceedFromStep(
  step: BulkImportWizardStep,
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): boolean {
  switch (step) {
    case "map":
      return (batch.wizardStepJson?.missingRequired?.length ?? 0) === 0;
    case "destination":
      return Boolean(batch.destinationClientAccountId && batch.destinationLocationIdGhl);
    case "review":
      return (summary.eligibleForSimulation ?? 0) > 0;
    case "simulate":
      return (
        batch.status === "simulation_complete" &&
        (summary.simulatedRows ?? batch.simulatedRows ?? 0) > 0
      );
    case "approve":
      return MONITOR_STATUSES.has(batch.status);
    default:
      return false;
  }
}

export function shouldPollBatchStatus(status: string): boolean {
  return status === "approved_for_delivery" || status === "delivery_running";
}
