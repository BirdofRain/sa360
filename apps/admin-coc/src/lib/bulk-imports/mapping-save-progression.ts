import type { BulkImportWizardStep } from "./types";

export type MappingSaveSubmitState = {
  mappingConfirmed: boolean;
  mappingChanged: boolean;
};

export function isMappingConfirmationRequired(mappingConfirmed: boolean): boolean {
  return !mappingConfirmed;
}

export function isMappingSaveRequired(state: MappingSaveSubmitState): boolean {
  return isMappingConfirmationRequired(state.mappingConfirmed) || state.mappingChanged;
}

export function shouldNoOpMappingSave(state: MappingSaveSubmitState): boolean {
  return state.mappingConfirmed && !state.mappingChanged;
}

export function mappingSaveButtonLabel(
  state: MappingSaveSubmitState,
  opts?: { saving?: boolean }
): string {
  if (opts?.saving) {
    return isMappingConfirmationRequired(state.mappingConfirmed)
      ? "Confirming mapping…"
      : "Saving…";
  }
  if (isMappingConfirmationRequired(state.mappingConfirmed)) {
    return "Confirm mapping & continue";
  }
  return "Save changes";
}

export function resolveMappingSaveSuccessMessage(input: {
  mappingChanged: boolean;
  confirmationChanged: boolean;
  resetPerformed: boolean;
}): string {
  if (input.confirmationChanged) {
    return "Mapping confirmed. Opening Destination…";
  }
  if (!input.mappingChanged) {
    return "No mapping changes to save.";
  }
  if (input.resetPerformed) {
    return "Mapping saved. Normalize the rows again to apply the new mapping.";
  }
  return "Mapping saved.";
}

export function shouldAdvanceWizardAfterMappingSave(
  nextStep: string | undefined
): nextStep is BulkImportWizardStep {
  return Boolean(nextStep && nextStep !== "map");
}

export function resolveMappingSaveWizardStep(
  nextStep: string | undefined
): BulkImportWizardStep {
  return (nextStep as BulkImportWizardStep | undefined) ?? "destination";
}

export type MappingSaveSuccessPayload = {
  batch: Record<string, unknown>;
  mappingChanged?: boolean;
  mappingConfirmed?: boolean;
  confirmationChanged?: boolean;
  resetPerformed?: boolean;
  nextStep?: string;
};

export function applyMappingSaveToBatchState(
  returnedBatch: Record<string, unknown>
): {
  batch: Record<string, unknown>;
  mappingConfirmed: boolean;
  wizardStep: string | undefined;
} {
  const wizardStepJson = (returnedBatch.wizardStepJson ?? {}) as {
    mappingConfirmed?: boolean;
    step?: string;
  };
  return {
    batch: returnedBatch,
    mappingConfirmed: wizardStepJson.mappingConfirmed === true,
    wizardStep: wizardStepJson.step,
  };
}
