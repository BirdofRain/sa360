import assert from "node:assert/strict";
import test from "node:test";
import {
  batchStatusAllowsLiveCanaryApproval,
  isBulkImportRowDeliverableSimulated,
  isBulkImportRowRetryablePreGhlFailure,
} from "./bulk-import-delivery-row-selection.service.js";

test("batchStatusAllowsLiveCanaryApproval includes completed for subsequent canary waves", () => {
  assert.equal(batchStatusAllowsLiveCanaryApproval("completed"), true);
  assert.equal(batchStatusAllowsLiveCanaryApproval("uploaded"), false);
});

test("isBulkImportRowDeliverableSimulated requires simulated undelivered row", () => {
  assert.equal(
    isBulkImportRowDeliverableSimulated({
      id: "row_1",
      rowNumber: 1,
      deliveryStatus: "simulated",
      duplicateStatus: "none",
      ghlContactId: null,
      ghlOpportunityId: null,
      sourceLeadEventId: "evt_1",
      excluded: false,
      validationStatus: "ready_for_simulation",
      deliveryAttempts: 0,
      errorCode: null,
      errorSummary: null,
    }),
    true
  );
  assert.equal(
    isBulkImportRowDeliverableSimulated({
      id: "row_2",
      rowNumber: 2,
      deliveryStatus: "delivered",
      duplicateStatus: "none",
      ghlContactId: "ghl_1",
      ghlOpportunityId: null,
      sourceLeadEventId: "evt_2",
      excluded: false,
      validationStatus: "ready_for_simulation",
      deliveryAttempts: 1,
      errorCode: null,
      errorSummary: null,
    }),
    false
  );
});

test("pre-GHL failed row is retryable when no GHL ids were written", () => {
  assert.equal(
    isBulkImportRowRetryablePreGhlFailure({
      id: "row_3",
      rowNumber: 3,
      deliveryStatus: "failed",
      duplicateStatus: "none",
      ghlContactId: null,
      ghlOpportunityId: null,
      sourceLeadEventId: "evt_3",
      excluded: false,
      validationStatus: "ready_for_simulation",
      deliveryAttempts: 1,
      errorCode: "delivery_blocked",
      errorSummary: "No active routing rule matched attribution",
    }),
    true
  );
});
