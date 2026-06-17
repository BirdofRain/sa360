import type { BulkImportWizardStep } from "./types";

export type BulkImportSummary = {
  totalRows?: number;
  identityEligible?: number;
  normalizedSourceEvents?: number;
  normalizationFailed?: number;
  missingSourceEvent?: number;
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
  updatedAt?: string;
  mappingJson?: Record<string, string>;
  destinationClientAccountId?: string | null;
  destinationLocationIdGhl?: string | null;
  importOptionsJson?: Record<string, unknown> | null;
  wizardStepJson?: {
    step?: string;
    missingRequired?: string[];
    headers?: string[];
    suggestions?: Array<{
      csvColumn: string;
      suggestedCanonical: string | null;
      confidence: "high" | "medium" | "low" | "none";
      action: string;
    }>;
    previewRows?: Array<{ rowNumber: number; fields: Record<string, string> }>;
    mappingConflicts?: Array<{ canonical: string; csvColumns: string[] }>;
  } | null;
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

const WIZARD_ORDER: BulkImportWizardStep[] = [
  "upload",
  "map",
  "destination",
  "review",
  "simulate",
  "approve",
  "monitor",
  "results",
];

export function getCompletedWizardSteps(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): Set<BulkImportWizardStep> {
  const completed = new Set<BulkImportWizardStep>(["upload"]);
  const mapping = batch.mappingJson ?? {};
  if (Object.keys(mapping).length > 0) {
    completed.add("map");
  }
  if (batch.status === "mapping_required" || batch.wizardStepJson?.step === "map") {
    completed.add("map");
  }
  if (batch.destinationClientAccountId && batch.destinationLocationIdGhl) {
    completed.add("map");
    completed.add("destination");
  }
  if (
    (summary.eligibleForSimulation ?? 0) > 0 ||
    batch.status === "ready_for_simulation" ||
    batch.status === "simulation_running" ||
    batch.status === "simulation_complete" ||
    MONITOR_STATUSES.has(batch.status)
  ) {
    completed.add("review");
  }
  if ((summary.simulatedRows ?? batch.simulatedRows ?? 0) > 0 || batch.status === "simulation_complete") {
    completed.add("simulate");
  }
  if (MONITOR_STATUSES.has(batch.status)) {
    completed.add("approve");
    completed.add("monitor");
  }
  if (RESULTS_STATUSES.has(batch.status) || (summary.deliveredRows ?? 0) > 0) {
    completed.add("results");
  }
  return completed;
}

export function requiresResetForWizardNavigation(
  target: BulkImportWizardStep,
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): { target: "mapping" | "destination" | "review"; message: string } | null {
  const current = deriveWizardStep(batch, summary);
  const currentIdx = WIZARD_ORDER.indexOf(current);
  const targetIdx = WIZARD_ORDER.indexOf(target);
  if (targetIdx >= currentIdx) return null;

  const hasNormalized = getCompletedWizardSteps(batch, summary).has("review");
  const hasSimulated = (summary.simulatedRows ?? batch.simulatedRows ?? 0) > 0;

  if (target === "destination" && hasSimulated) {
    return {
      target: "destination",
      message: "Changing the destination requires clearing existing simulations.",
    };
  }
  if (target === "destination" && hasNormalized && !hasSimulated) {
    return {
      target: "destination",
      message:
        "Changing the destination requires resetting normalized Source Intake records and simulation results.",
    };
  }
  if (target === "review" && hasSimulated) {
    return {
      target: "review",
      message: "Returning to review will clear existing simulation results.",
    };
  }
  return null;
}

export function deriveWizardStep(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): BulkImportWizardStep {
  const wizardStep = batch.wizardStepJson?.step ?? summary.wizardStep;
  if (wizardStep === "map" || batch.status === "mapping_required") return "map";
  if (wizardStep === "destination" && !batch.destinationClientAccountId) return "destination";
  if (wizardStep === "review" && batch.destinationClientAccountId) return "review";
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
  const targetIdx = WIZARD_ORDER.indexOf(target);
  const currentIdx = WIZARD_ORDER.indexOf(current);
  if (targetIdx < 0 || currentIdx < 0) return false;
  const completed = getCompletedWizardSteps(batch, summary);
  if (completed.has(target)) return true;
  return targetIdx === currentIdx;
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

export function resolveActiveWizardStep(
  batch: BulkImportBatchState,
  summary: BulkImportSummary,
  requestedStep?: BulkImportWizardStep
): BulkImportWizardStep {
  if (requestedStep && canAccessWizardStep(requestedStep, batch, summary)) {
    return requestedStep;
  }
  const persisted = batch.wizardStepJson?.step as BulkImportWizardStep | undefined;
  if (persisted && canAccessWizardStep(persisted, batch, summary)) {
    return persisted;
  }
  return deriveWizardStep(batch, summary);
}
