import type { BulkImportRowSummary } from "./bulk-import.types.js";

export type BulkImportWizardStepName =
  | "map"
  | "destination"
  | "review"
  | "simulate"
  | "approve"
  | "monitor"
  | "results";

export function resolveMappingSaveNextStep(input: {
  missingRequired: string[];
  hasDestination: boolean;
}): BulkImportWizardStepName {
  if (input.missingRequired.length > 0) return "map";
  if (input.hasDestination) return "review";
  return "destination";
}

export function resolveDestinationSaveNextStep(): BulkImportWizardStepName {
  return "review";
}

export function resolveNormalizeNextStep(
  summary: Pick<BulkImportRowSummary, "eligibleForSimulation">
): BulkImportWizardStepName {
  return (summary.eligibleForSimulation ?? 0) > 0 ? "simulate" : "review";
}

export function resolveSimulateNextStep(simulatedRows: number): BulkImportWizardStepName {
  return simulatedRows > 0 ? "approve" : "simulate";
}

export function resolveApproveNextStep(): BulkImportWizardStepName {
  return "monitor";
}

export function resolveDeliveryCompleteNextStep(): BulkImportWizardStepName {
  return "results";
}
