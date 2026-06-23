import { BULK_IMPORT_SIMULATION_BATCH_LIMIT } from "./simulation-limits";

export type SimulationRunSummary = {
  eligibleTotal: number;
  runLimit: number;
  targetRowCount: number;
  simulatedRows: number;
  failedRows: number;
  skippedByLimit: number;
  skippedReason: string | null;
};

export function buildSimulationRunSummary(input: {
  eligibleTotal: number;
  targetRowCount: number;
  simulatedRows: number;
  failedRows: number;
  runLimit?: number;
}): SimulationRunSummary {
  const runLimit = input.runLimit ?? BULK_IMPORT_SIMULATION_BATCH_LIMIT;
  const skippedByLimit = Math.max(0, input.eligibleTotal - input.targetRowCount);

  return {
    eligibleTotal: input.eligibleTotal,
    runLimit,
    targetRowCount: input.targetRowCount,
    simulatedRows: input.simulatedRows,
    failedRows: input.failedRows,
    skippedByLimit,
    skippedReason:
      skippedByLimit > 0
        ? `${skippedByLimit} eligible row${skippedByLimit === 1 ? "" : "s"} skipped because each simulation run is limited to ${runLimit} row${runLimit === 1 ? "" : "s"}. Run simulation again to process remaining rows.`
        : null,
  };
}

export function assertSimulationCountIntegrity(summary: SimulationRunSummary): void {
  const total = summary.simulatedRows + summary.failedRows + summary.skippedByLimit;
  if (total !== summary.eligibleTotal) {
    throw new Error(
      `Simulation count mismatch: eligible ${summary.eligibleTotal} !== simulated ${summary.simulatedRows} + failed ${summary.failedRows} + skipped ${summary.skippedByLimit}`
    );
  }
}
