import assert from "node:assert/strict";
import test from "node:test";
import {
  batchHasLiveDeliveryApproval,
  isSimulationLocked,
  resolveSimulationResetEligibility,
  SIMULATION_LOCKED_MESSAGE,
  SIMULATION_RESET_DELIVERED_BLOCK_MESSAGE,
} from "./simulation-lock-state.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";

test("batchHasLiveDeliveryApproval is true when approvedAt is set on failed batch", () => {
  assert.equal(
    batchHasLiveDeliveryApproval({ status: "failed", approvedAt: "2026-06-17T12:00:00.000Z" }),
    true
  );
});

test("batchHasLiveDeliveryApproval is false for failed batch without approval", () => {
  assert.equal(batchHasLiveDeliveryApproval({ status: "failed", approvedAt: null }), false);
});

test("isSimulationLocked mirrors live approval state", () => {
  const batch: BulkImportBatchState & { approvedAt?: string | null } = {
    status: "approved_for_delivery",
    approvedAt: "2026-06-17T12:00:00.000Z",
  };
  assert.equal(isSimulationLocked(batch, {}), true);
});

test("resolveSimulationResetEligibility blocks reset when rows were delivered", () => {
  const summary: BulkImportSummary = { deliveredRows: 1 };
  const result = resolveSimulationResetEligibility(summary);
  assert.equal(result.allowed, false);
  assert.equal(result.blockMessage, SIMULATION_RESET_DELIVERED_BLOCK_MESSAGE);
});

test("resolveSimulationResetEligibility allows reset for failed canary without delivery", () => {
  const result = resolveSimulationResetEligibility({ deliveredRows: 0, failedRows: 1 });
  assert.equal(result.allowed, true);
  assert.equal(result.blockMessage, null);
});

test("SIMULATION_LOCKED_MESSAGE explains reset path", () => {
  assert.match(SIMULATION_LOCKED_MESSAGE, /Reset to Review/i);
  assert.match(SIMULATION_LOCKED_MESSAGE, /Simulation is locked/i);
});
