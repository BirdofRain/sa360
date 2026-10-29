import test from "node:test";
import assert from "node:assert/strict";
import { GHL_SINGLE_PLAN_CANARY_ID_ENV } from "../../lib/ghl-single-plan-canary.js";
import { BulkImportApprovalError } from "./bulk-import-approval.error.js";
import { approveBulkImportDelivery } from "./bulk-lead-import.service.js";

test("bulk live approval refuses before batch lookup while a single-plan canary pin is set", async () => {
  const prev = process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
  process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = "plan_pinned";
  try {
    await assert.rejects(
      () =>
        approveBulkImportDelivery("batch_does_not_exist", {
          operatorConfirmationText: "not-the-confirmation",
        }),
      (err: unknown) => {
        assert.ok(err instanceof BulkImportApprovalError);
        assert.equal(err.code, "single_plan_canary_pin");
        assert.equal(err.blockers.length, 1);
        return true;
      }
    );
  } finally {
    if (prev !== undefined) process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = prev;
    else delete process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
  }
});
