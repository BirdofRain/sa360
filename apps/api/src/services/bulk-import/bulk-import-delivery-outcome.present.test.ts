import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBulkImportPreGhlFailureBanner,
  normalizeBulkImportPreGhlFailureReason,
  resolveBulkImportDeliveryOutcome,
  resolveBulkImportWorkerJobState,
  summarizeBulkImportRowFailures,
} from "./bulk-import-delivery-outcome.present.js";

test("formatBulkImportPreGhlFailureBanner surfaces routing failure at top", () => {
  const banner = formatBulkImportPreGhlFailureBanner({
    failedCount: 1,
    primaryReason:
      "No active routing rule matched attribution; manual review required.",
  });
  assert.equal(
    banner,
    "1 row failed before GHL write: No active routing rule matched attribution."
  );
});

test("normalizeBulkImportPreGhlFailureReason maps routing matcher copy", () => {
  assert.equal(
    normalizeBulkImportPreGhlFailureReason(
      "No active routing rule matched attribution; manual review required."
    ),
    "No active routing rule matched attribution."
  );
});

test("worker job completed with zero delivered rows yields failed delivery outcome", () => {
  assert.equal(resolveBulkImportWorkerJobState([{ state: "completed" }]), "completed");
  assert.equal(
    resolveBulkImportDeliveryOutcome({
      batchStatus: "failed",
      rowsDelivered: 0,
      rowsFailed: 1,
      approvedRowCount: 1,
    }),
    "failed"
  );
});

test("summarizeBulkImportRowFailures includes operator message for monitor", () => {
  const failures = summarizeBulkImportRowFailures([
    {
      id: "row_1",
      rowNumber: 1,
      deliveryStatus: "failed",
      deliveryAttempts: 1,
      errorCode: "delivery_blocked",
      errorSummary:
        "No active routing rule matched attribution; manual review required.",
    },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.operatorMessage, "No active routing rule matched attribution.");
});
