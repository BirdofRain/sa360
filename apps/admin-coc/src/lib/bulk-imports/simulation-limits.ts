/** Maximum eligible rows simulated per wizard action (live canary safety). */
export const BULK_IMPORT_SIMULATION_BATCH_LIMIT = 5;

export function simulationRunLimit(eligibleForSimulation: number): number {
  return Math.min(Math.max(eligibleForSimulation, 0), BULK_IMPORT_SIMULATION_BATCH_LIMIT);
}
