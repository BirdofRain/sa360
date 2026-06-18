import type { BulkImportWizardStep } from "./types";
import {
  deriveWizardStep,
  resolveActiveWizardStep,
  type BulkImportBatchState,
  type BulkImportSummary,
} from "./wizard-steps";

export function resolvePostActionWizardStep(
  nextStep: string | undefined,
  batch: BulkImportBatchState,
  summary: BulkImportSummary
): BulkImportWizardStep {
  if (nextStep) {
    return resolveActiveWizardStep(batch, summary, nextStep as BulkImportWizardStep);
  }
  return deriveWizardStep(batch, summary);
}

export type WizardAdvancePayload = {
  batch?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  nextStep?: string;
  results?: unknown[];
};

export function applyWizardAdvancePayload(
  currentBatch: Record<string, unknown>,
  payload: WizardAdvancePayload
): Record<string, unknown> {
  if (!payload.batch) return currentBatch;
  const nextBatch = { ...payload.batch };
  if (payload.results?.length) {
    const wizardStepJson = {
      ...((nextBatch.wizardStepJson as object | undefined) ?? {}),
      simulationResults: payload.results,
    };
    nextBatch.wizardStepJson = wizardStepJson;
  }
  return nextBatch;
}
