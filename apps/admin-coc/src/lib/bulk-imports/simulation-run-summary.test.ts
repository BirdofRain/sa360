import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSimulationCountIntegrity,
  buildSimulationRunSummary,
} from "./simulation-run-summary.ts";

test("eligible count equals simulated + failed + skipped by run limit", () => {
  const summary = buildSimulationRunSummary({
    eligibleTotal: 6,
    targetRowCount: 5,
    simulatedRows: 5,
    failedRows: 0,
  });

  assert.equal(summary.skippedByLimit, 1);
  assert.match(summary.skippedReason ?? "", /limited to 5/i);
  assert.doesNotThrow(() => assertSimulationCountIntegrity(summary));
});

test("no silent eligible-row loss when all rows attempted", () => {
  const summary = buildSimulationRunSummary({
    eligibleTotal: 4,
    targetRowCount: 4,
    simulatedRows: 3,
    failedRows: 1,
  });

  assert.equal(summary.skippedByLimit, 0);
  assert.doesNotThrow(() => assertSimulationCountIntegrity(summary));
});

test("integrity check throws when counts do not reconcile", () => {
  const summary = buildSimulationRunSummary({
    eligibleTotal: 6,
    targetRowCount: 5,
    simulatedRows: 4,
    failedRows: 0,
  });

  assert.throws(() => assertSimulationCountIntegrity(summary), /mismatch/i);
});
