import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps";

export type ReviewSimulationBanner =
  | { kind: "pending_normalization"; message: string }
  | { kind: "blocked"; message: string };

export const REVIEW_PENDING_NORMALIZATION_MESSAGE =
  "Rows are pending normalization. Click Normalize & review to classify rows before simulation.";

export const REVIEW_BLOCKED_SIMULATION_MESSAGE =
  "No eligible rows for simulation. Resolve blockers above before continuing.";

export function normalizationHasRun(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): boolean {
  if ((summary.normalizedSourceEvents ?? 0) > 0) return true;
  if ((summary.normalizationFailed ?? 0) > 0) return true;
  if ((summary.missingSourceEvent ?? 0) > 0) return true;
  if (batch.status === "ready_for_simulation") return true;
  if (batch.status === "simulation_running") return true;
  if (batch.status === "simulation_complete") return true;
  return false;
}

export function resolveReviewSimulationBanner(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): ReviewSimulationBanner | null {
  const eligibleForSimulation = summary.eligibleForSimulation ?? 0;
  const missingSourceEvent = summary.missingSourceEvent ?? 0;

  if (eligibleForSimulation > 0 || missingSourceEvent > 0) {
    return null;
  }

  if (!normalizationHasRun(batch, summary)) {
    return {
      kind: "pending_normalization",
      message: REVIEW_PENDING_NORMALIZATION_MESSAGE,
    };
  }

  return {
    kind: "blocked",
    message: REVIEW_BLOCKED_SIMULATION_MESSAGE,
  };
}
