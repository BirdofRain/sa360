import type { BulkImportWizardStep } from "./types";

export type WizardMessage = {
  step: BulkImportWizardStep;
  kind: "loading" | "success" | "warning";
  text: string;
};

export function messageForViewStep(
  message: WizardMessage | null,
  viewStep: BulkImportWizardStep
): WizardMessage | null {
  if (!message || message.step !== viewStep) return null;
  return message;
}

export function loadingMessageForStep(
  step: BulkImportWizardStep,
  text: string
): WizardMessage {
  return { step, kind: "loading", text };
}

export function successMessageForStep(
  step: BulkImportWizardStep,
  text: string
): WizardMessage {
  return { step, kind: "success", text };
}
