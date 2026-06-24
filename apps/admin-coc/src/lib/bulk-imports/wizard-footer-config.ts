import type { BulkImportWizardStep } from "./types";
import { resolveReviewSimulationBanner } from "./review-step-messaging";
import { simulationRunLimit } from "./simulation-limits";
import {
  SIMULATION_LOCKED_MESSAGE,
  isSimulationLocked,
  resolveSimulationResetEligibility,
} from "./simulation-lock-state";
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
  | "clear-live-approval"
  | "approve"
  | "navigate"
  | "refresh-results"
  | "none";

export type WizardFooterConfig = {
  previousViewStep: BulkImportWizardStep | null;
  previousLabel: string | null;
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryDisabledReason: string | null;
  /** Additional context lines shown above the footer actions (e.g. approve blockers). */
  statusLines?: string[];
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
  approvalText?: string;
  preflightBlockers?: string[];
  stepReadOnly?: boolean;
}): WizardFooterConfig {
  const progressStep = deriveProgressStep(input.batch, input.summary);
  const progressIdx = WIZARD_STEP_ORDER.indexOf(progressStep);
  const disabledByMutation = input.mutationActive;

  const navigatePrimary = (
    target: BulkImportWizardStep,
    label: string,
    disabled = false,
    disabledReason: string | null = null
  ): WizardFooterConfig => ({
    previousViewStep: previousInFlow(input.viewStep),
    previousLabel: previousInFlow(input.viewStep)
      ? `← Previous: ${stepLabel(previousInFlow(input.viewStep)!)}`
      : null,
    primaryLabel: label,
    primaryDisabled: disabled || disabledByMutation,
    primaryDisabledReason:
      disabled || disabledByMutation ? disabledReason ?? (disabledByMutation ? "An import action is still running." : null) : null,
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
          primaryDisabledReason: disabledByMutation ? "An import action is still running." : null,
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
      if (input.stepReadOnly) {
        return {
          previousViewStep: prev,
          previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
          primaryLabel: "Save destination",
          primaryDisabled: true,
          primaryDisabledReason:
            "This step has already been completed for this batch. Restart/reset the wizard to change it.",
          primaryAction: "save-destination",
        };
      }
      if (!input.destinationSaved) {
        const draftInvalid = !input.destinationDraftValid;
        return {
          previousViewStep: prev,
          previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
          primaryLabel: disabledByMutation ? "Saving destination…" : "Save destination",
          primaryDisabled: disabledByMutation || draftInvalid,
          primaryDisabledReason: disabledByMutation
            ? "An import action is still running."
            : draftInvalid
              ? "Select a client and location before saving."
              : null,
          primaryAction: "save-destination",
        };
      }
      if (progressIdx > WIZARD_STEP_ORDER.indexOf("review")) {
        return {
          previousViewStep: prev,
          previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
          primaryLabel: `Return to ${stepLabel(progressStep)}`,
          primaryDisabled: disabledByMutation,
          primaryDisabledReason: disabledByMutation ? "An import action is still running." : null,
          primaryAction: "navigate",
          primaryTargetStep: progressStep,
        };
      }
      return {
        previousViewStep: prev,
        previousLabel: prev ? `← Previous: ${stepLabel(prev)}` : null,
        primaryLabel: "Return to Review",
        primaryDisabled: disabledByMutation,
        primaryDisabledReason: disabledByMutation ? "An import action is still running." : null,
        primaryAction: "navigate",
        primaryTargetStep: "review",
      };
    }
    case "review": {
      const banner = resolveReviewSimulationBanner(input.batch, input.summary);
      const normalizeBlocked =
        banner?.kind === "blocked" && input.missingSourceEvent === 0;
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
        primaryDisabled: disabledByMutation || normalizeBlocked,
        primaryDisabledReason: disabledByMutation
          ? "An import action is still running."
          : normalizeBlocked
            ? banner?.message ?? null
            : null,
        statusLines:
          banner && !normalizeBlocked ? [banner.message] : undefined,
        primaryAction: "normalize",
      };
    }
    case "simulate": {
      const batchWithApproval = input.batch as BulkImportBatchState & {
        approvedAt?: string | Date | null;
      };
      if (isSimulationLocked(batchWithApproval, input.summary)) {
        const resetEligibility = resolveSimulationResetEligibility(input.summary);
        return {
          previousViewStep: "review",
          previousLabel: "← Previous: Review",
          primaryLabel: "Reset to Review and clear live approval",
          primaryDisabled: disabledByMutation || !resetEligibility.allowed,
          primaryDisabledReason: disabledByMutation
            ? "An import action is still running."
            : resetEligibility.blockMessage,
          statusLines: resetEligibility.allowed
            ? [SIMULATION_LOCKED_MESSAGE]
            : [SIMULATION_LOCKED_MESSAGE, resetEligibility.blockMessage ?? ""].filter(Boolean),
          primaryAction: "clear-live-approval",
        };
      }
      const simulated =
        input.batch.status === "simulation_complete" ||
        (input.summary.simulatedRows ?? input.batch.simulatedRows ?? 0) > 0;
      if (simulated) {
        return {
          previousViewStep: "review",
          previousLabel: "← Previous: Review",
          primaryLabel: "Continue to Approval",
          primaryDisabled: disabledByMutation,
          primaryDisabledReason: disabledByMutation ? "An import action is still running." : null,
          primaryAction: "navigate",
          primaryTargetStep: "approve",
        };
      }
      const noEligibleSim = input.eligibleForSimulation === 0;
      return {
        previousViewStep: "review",
        previousLabel: "← Previous: Review",
        primaryLabel: disabledByMutation
          ? "Simulating…"
          : `Simulate ${simulationRunLimit(input.eligibleForSimulation)} eligible row${
              simulationRunLimit(input.eligibleForSimulation) === 1 ? "" : "s"
            }`,
        primaryDisabled: disabledByMutation || noEligibleSim,
        primaryDisabledReason: disabledByMutation
          ? "An import action is still running."
          : noEligibleSim
            ? "No rows are eligible for simulation."
            : null,
        primaryAction: "simulate",
      };
    }
    case "approve": {
      return {
        previousViewStep: "simulate",
        previousLabel: "← Previous: Simulation",
        primaryLabel: "",
        primaryDisabled: true,
        primaryDisabledReason: null,
        primaryAction: "none",
      };
    }
    case "monitor":
      return {
        previousViewStep: "approve",
        previousLabel: "← Previous: Approve",
        primaryLabel: "",
        primaryDisabled: true,
        primaryDisabledReason: null,
        primaryAction: "none",
      };
    case "results":
      return {
        previousViewStep: "monitor",
        previousLabel: "← Previous: Monitor",
        primaryLabel: "",
        primaryDisabled: true,
        primaryDisabledReason: null,
        primaryAction: "none",
      };
    default:
      return {
        previousViewStep: null,
        previousLabel: null,
        primaryLabel: "",
        primaryDisabled: true,
        primaryDisabledReason: null,
        primaryAction: "none",
      };
  }
}
