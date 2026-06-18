export type WizardActionKey =
  | "mapping"
  | "destination"
  | "normalize"
  | "simulate"
  | "approve"
  | "refresh";

export type WizardActionError = {
  action: WizardActionKey;
  code?: string;
  message: string;
};

const STALE_SIMULATION_ERROR_CODES = new Set([
  "no_eligible_rows_for_simulation",
]);

const NON_STALE_SIMULATION_ERROR_CODES = new Set(["all_simulations_failed", "normalization_incomplete"]);

const STALE_SIMULATION_MESSAGE =
  "No eligible rows were available for simulation.";

export function isStaleSimulationError(
  error: WizardActionError | null,
  eligibleForSimulation: number
): boolean {
  if (!error || error.action !== "simulate" || eligibleForSimulation <= 0) {
    return false;
  }
  if (error.code && NON_STALE_SIMULATION_ERROR_CODES.has(error.code)) {
    return false;
  }
  if (error.code && STALE_SIMULATION_ERROR_CODES.has(error.code)) {
    return true;
  }
  return error.message.includes(STALE_SIMULATION_MESSAGE);
}

export function clearWizardActionError(
  error: WizardActionError | null,
  options: {
    eligibleForSimulation?: number;
    stepChanged?: boolean;
    importChanged?: boolean;
  }
): WizardActionError | null {
  if (!error) return null;
  if (options.importChanged) return null;
  if (options.stepChanged && error.action === "simulate") return null;
  if (
    options.eligibleForSimulation !== undefined &&
    isStaleSimulationError(error, options.eligibleForSimulation)
  ) {
    return null;
  }
  return error;
}
