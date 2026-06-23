import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveApproveDeliveryReadiness,
} from "./approve-delivery-readiness.ts";
import { BULK_IMPORT_APPROVE_PHRASE } from "./types.ts";

test("valid approval phrase with preflight blockers keeps approve disabled", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 5,
    preflightReady: false,
    preflightBlockers: [
      "Effective runtime mode is simulate; live_canary is required.",
      "Client cutover has not been approved.",
    ],
  });

  assert.equal(readiness.phraseAccepted, true);
  assert.equal(readiness.canApprove, false);
  assert.ok(readiness.statusLines.includes("Approval phrase accepted."));
  assert.ok(
    readiness.statusLines.some((line) => line.includes("blocked until all preflight"))
  );
});

test("approve UI status shows phrase accepted and blocker list", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 5,
    preflightReady: false,
    preflightBlockers: ["Worker/API dispatch configuration is unavailable."],
  });

  assert.equal(readiness.remainingBlockers.length >= 2, true);
  assert.ok(
    readiness.remainingBlockers.some((line) => line.includes("Worker/API dispatch"))
  );
});

test("all checks passed enables approve", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 3,
    preflightReady: true,
    preflightBlockers: [],
  });

  assert.equal(readiness.canApprove, true);
});
