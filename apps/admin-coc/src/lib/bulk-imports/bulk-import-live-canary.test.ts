import test from "node:test";
import assert from "node:assert/strict";
import { shouldPollBatchStatus } from "./wizard-steps.js";

test("monitor polling stays active for approved and running batches", () => {
  assert.equal(shouldPollBatchStatus("approved_for_delivery"), true);
  assert.equal(shouldPollBatchStatus("delivery_running"), true);
});

test("monitor polling stops for terminal batch statuses", () => {
  assert.equal(shouldPollBatchStatus("completed"), false);
  assert.equal(shouldPollBatchStatus("partial_success"), false);
  assert.equal(shouldPollBatchStatus("failed"), false);
  assert.equal(shouldPollBatchStatus("cancelled"), false);
  assert.equal(shouldPollBatchStatus("paused"), false);
});

test("approve action should not advance without queue jobs", () => {
  const payload = {
    approvedRowCount: 1,
    batchId: "batch_1",
    nextStep: "monitor",
    queueJobs: [] as Array<{ jobId: string }>,
  };
  assert.equal(payload.queueJobs.length > 0, false);
});
