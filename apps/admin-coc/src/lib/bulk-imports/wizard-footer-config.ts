import type { BulkImportWizardStep } from "./types";
import {
  deriveProgressStep,
  type BulkImportBatchState,
  type BulkImportSummary,
  WIZARD_STEP_ORDER,
} from "./wizard-steps";

export type WizardFooterPrimaryAction =
  | "confirm-mapping"
  | "save-destination"
  | "normalize"
  | "simulate"
  | "approve"
  | "navigate"
  | "refresh-results"
  | "none";

export type WizardFooterConfig = {
  previousViewStep: BulkImportWizardStep | null;
  previousLabel: string | null;
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryAction: WizardFooterPrimaryAction;
  primaryTargetStep?: BulkImportWizardStep;
};

function stepLabel(step: BulkImportWizardStep): string {
  return step.charAt(0).toUpperCase() + step.slice(1);
}

function previousInFlow(step: BulkImportWizardStep): BulkImportWizardStep | null {
  const idx = WIZARD_STEP_ORDER.indexOf(step);
  if (idx <= 1) return null;
  return WIZARD_STEP_ORDER[idx - 1] ?? null;
}

export function resolveWizardFooterConfig(input: {
  viewStep: BulkImportWizardStep;
  batch: BulkImportBatchState;
  summary: BulkImportSummary;
  mappingConfirmed: boolean;
  destinationDraftValid: boolean;
  destinationSaved: boolean;
  eligibleForSimulation: number;
  eligibleSimulatedCount: number;
  missingSourceEvent: number;
  mutationActive: boolean;
  preflightReady: boolean | null;
  approvalPhraseValid: boolean;
}): WizardFooterConfig {
  const progressStep = deriveProgressStep(input.batch, input.summary);
  const progressIdx = WIZARD_STEP_ORDER.indexOf(progressStep);
  const disabledByMutation = input.mutationActive;

  const navigatePrimary = (
    target: BulkImportWizardStep,
    label: string,
    disabled = false
  ): WizardFooterConfig => ({
    previousViewStep: previousInFlow(input.viewStep),
    previousLabel: previousInFlow(input.viewStep)
      ? `← Previous: ${stepLabel(previousInFlow(input.viewStep)!)}`
      : null,
    primaryLabel: label,
    primaryDisabled: disabled || disabledByMutation,
    primaryAction: "navigate",
    primaryTargetStep: target,
  });

  switch (input.viewStep) {
    case "map": {
      if (!input.mappingConfirmed) {
        return {
          previousViewStep: null,
          previousLabel: null,
          primaryLabel: "Confirm mapping & continue",
          primaryDisabled: disabledByMutation,
          primaryAction: "confirm-mapping",
        };
      }
      if (progressIdx > WIZARD_STEP_ORDER.indexOf("destination")) {
        return navigatePrimary(progressStep, `Return to ${stepLabel(progressStep)}`);
      }
      if (progressStep === "destination") {
        return navigatePrimary("destination", "Return to Destination");
      }
      if (progressStep === "review") {
        return navigatePrimary("review", "Return to Review");
      }
      if (progressStep === "simulate") {
        return navigatePrimary("simulate", "Return to Simulation");
      }
      return navigatePrimary("destination", "Continue to Destination");
    }
    case "destination": {
      const prev = previousInFlow("destination");
      if (!input.destinationSaved) {
        return {
          previousViewStep: prev,
          previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
          primaryLabel: disabledByMutation ? "Saving destination…" : "Save destination",
          primaryDisabled:
            disabledByMutation || !input.destinationDraftValid,
          primaryAction: "save-destination",
        };
      }
      if (progressIdx > WIZARD_STEP_ORDER.indexOf("review")) {
        return {
          previousViewStep: prev,
          previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
          primaryLabel: `Return to ${stepLabel(progressStep)}`,
          primaryDisabled: disabledByMutation,
          primaryAction: "navigate",
          primaryTargetStep: progressStep,
        };
      }
      return {
        previousViewStep: prev,
        previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
        primaryLabel: "Return to Review",
        primaryDisabled: disabledByMutation,
        primaryAction: "navigate",
        primaryTargetStep: "review",
      };
    }
    case "review":
      return {
        previousViewStep: "destination",
        previousLabel: "← Previous: Destination",
        primaryLabel:
          input.missingSourceEvent > 0
            ? disabledByMutation
              ? "Repairing normalization…"
              : "Repair normalization"
            : disabledByMutation
              ? "Normalizing…"
              : "Normalize & review",
        primaryDisabled:
          disabledByMutation ||
          (input.missingSourceEvent === 0 && input.eligibleForSimulation === 0),
        primaryAction: "normalize",
      };
    case "simulate": {
      const simulated =
        input.batch.status === "simulation_complete" ||
        (input.summary.simulatedRows ?? input.batch.simulatedRows ?? 0) > 0;
      if (simulated) {
        return {
          previousViewStep: "review",
          previousLabel: "← Previous: Review",
          primaryLabel: "Continue to Approval",
          primaryDisabled: disabledByMutation,
          primaryAction: "navigate",
          primaryTargetStep: "approve",
        };
      }
      return {
        previousViewStep: "review",
        previousLabel: "← Previous: Review",
        primaryLabel: disabledByMutation
          ? "Simulating…"
          : `Simulate ${Math.min(input.eligibleForSimulation, 5)} eligible row${
              Math.min(input.eligibleForSimulation, 5) === 1 ? "" : "s"
            }`,
        primaryDisabled: disabledByMutation || input.eligibleForSimulation === 0,
        primaryAction: "simulate",
      };
    }
    case "approve":
      return {
        previousViewStep: "simulate",
        previousLabel: "← Previous: Simulation",
        primaryLabel: disabledByMutation ? "Approving…" : "Approve delivery wave",
        primaryDisabled:
          disabledByMutation ||
          !input.approvalPhraseValid ||
          input.eligibleSimulatedCount === 0 ||
          input.preflightReady === false,
        primaryAction: "approve",
      };
    case "monitor":
      return {
        previousViewStep: "approve",
        previousLabel: "← Previous: Approve",
        primaryLabel: "View Results",
        primaryDisabled: disabledByMutation,
        primaryAction: "navigate",
        primaryTargetStep: "results",
      };
    default:
      return {
        previousViewStep: null,
        previousLabel: null,
        primaryLabel: "",
        primaryDisabled: true,
        primaryAction: "none",
      };
  }
}
