import type { BulkImportWizardStep } from "./types";
import {
  canAccessWizardStep,
  deriveWizardStep,
  getCompletedWizardSteps,
  requiresResetForWizardNavigation,
  WIZARD_STEP_ORDER,
  type BulkImportBatchState,
  type BulkImportSummary,
} from "./wizard-steps";

export const STEP_COMPLETED_READONLY_MESSAGE =
  "This step has already been completed for this batch. Restart/reset the wizard to change it.";

export type WizardStepRouting = {
  /** Step to open when no `?step=` query param is present. */
  defaultStep: BulkImportWizardStep;
  /** Parsed `searchParams.step` when present and recognized. */
  requestedStep?: BulkImportWizardStep;
  /** Step whose content is rendered (URL wins when accessible). */
  renderedStep: BulkImportWizardStep;
  /** Furthest unlocked progress from persisted batch state. */
  furthestUnlockedStep: BulkImportWizardStep;
  /** Shown when a gated future step was requested and we fell back. */
  stepBlockedReason: string | null;
  /** Shown when viewing a completed earlier step in read-only mode. */
  stepReadOnlyMessage: string | null;
};

export function deriveDefaultStep(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): BulkImportWizardStep {
  return deriveWizardStep(batch, summary);
}

export function deriveFurthestUnlockedStep(
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): BulkImportWizardStep {
  return deriveWizardStep(batch, summary);
}

function nearestAccessibleStep(
  batch: BulkImportBatchState,
  summary: BulkImportSummary,
  requested: BulkImportWizardStep
): BulkImportWizardStep | undefined {
  const requestedIdx = WIZARD_STEP_ORDER.indexOf(requested);
  if (requestedIdx < 0) return undefined;
  for (let idx = requestedIdx; idx >= 0; idx--) {
    const step = WIZARD_STEP_ORDER[idx];
    if (step && canAccessWizardStep(step, batch, summary)) {
      return step;
    }
  }
  return undefined;
}

export function getStepBlockedReason(
  target: BulkImportWizardStep,
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): string {
  if (canAccessWizardStep(target, batch, summary)) {
    return "";
  }
  switch (target) {
    case "destination":
      return "Destination is available after mapping is confirmed.";
    case "review":
      return "Review is available after a destination is saved or Source Intake records exist.";
    case "simulate":
      return "Simulation is available after rows are normalized and eligible for simulation.";
    case "approve":
      return "Approval is available after at least one row is simulated successfully.";
    case "monitor":
      return "Monitor is available after a delivery wave is approved.";
    case "results":
      return "Results are available after delivery has started or completed.";
    default:
      return `The ${target} step is not available yet for this batch.`;
  }
}

export function getStepReadOnlyMessage(
  step: BulkImportWizardStep,
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): string | null {
  if (!canAccessWizardStep(step, batch, summary)) {
    return null;
  }

  const furthest = deriveFurthestUnlockedStep(batch, summary);
  const stepIdx = WIZARD_STEP_ORDER.indexOf(step);
  const furthestIdx = WIZARD_STEP_ORDER.indexOf(furthest);
  if (stepIdx < 0 || furthestIdx < 0 || stepIdx >= furthestIdx) {
    return null;
  }

  const completed = getCompletedWizardSteps(batch, summary);
  if (!completed.has(step)) {
    return null;
  }

  const hasDownstream =
    (summary.normalizedSourceEvents ?? 0) > 0 ||
    (summary.simulatedRows ?? batch.simulatedRows ?? 0) > 0 ||
    completed.has("simulate") ||
    completed.has("monitor");

  if (!hasDownstream) {
    return null;
  }

  if (step === "map" || step === "destination") {
    return STEP_COMPLETED_READONLY_MESSAGE;
  }

  if (requiresResetForWizardNavigation(step, batch, summary)) {
    return STEP_COMPLETED_READONLY_MESSAGE;
  }

  return null;
}

/** URL `?step=` is the source of truth when the requested step is accessible. */
export function resolveWizardStepRouting(
  batch: BulkImportBatchState,
  summary: BulkImportSummary,
  requestedStep?: BulkImportWizardStep
): WizardStepRouting {
  const defaultStep = deriveDefaultStep(batch, summary);
  const furthestUnlockedStep = deriveFurthestUnlockedStep(batch, summary);

  if (!requestedStep) {
    return {
      defaultStep,
      renderedStep: defaultStep,
      furthestUnlockedStep,
      stepBlockedReason: null,
      stepReadOnlyMessage: null,
    };
  }

  if (canAccessWizardStep(requestedStep, batch, summary)) {
    return {
      requestedStep,
      defaultStep,
      renderedStep: requestedStep,
      furthestUnlockedStep,
      stepBlockedReason: null,
      stepReadOnlyMessage: getStepReadOnlyMessage(requestedStep, batch, summary),
    };
  }

  const fallback = nearestAccessibleStep(batch, summary, requestedStep) ?? defaultStep;
  return {
    requestedStep,
    defaultStep,
    renderedStep: fallback,
    furthestUnlockedStep,
    stepBlockedReason: getStepBlockedReason(requestedStep, batch, summary),
    stepReadOnlyMessage: getStepReadOnlyMessage(fallback, batch, summary),
  };
}
