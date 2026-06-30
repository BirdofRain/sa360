import assert from "node:assert/strict";
import test from "node:test";
import { BULK_IMPORT_APPROVE_PHRASE } from "./types";
import { resolveApproveDeliveryReadiness } from "./approve-delivery-readiness";

test("phrase + preflight ready enables approve", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 1,
    selectedRowCount: 1,
    selectedRowsRoutingReady: true,
    preflightReady: true,
    preflightBlockers: [],
  });
  assert.equal(readiness.canApprove, true);
});

test("internal not_reviewed keeps approve disabled via preflight blockers", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 1,
    selectedRowCount: 1,
    selectedRowsRoutingReady: true,
    preflightReady: false,
    preflightBlockers: ["Internal approval status is not_reviewed; approved is required."],
  });
  assert.equal(readiness.canApprove, false);
  assert.ok(
    readiness.remainingBlockers.some((b) => b.includes("Internal approval status is not_reviewed"))
  );
});

test("cutover not approved keeps approve disabled via preflight blockers", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 1,
    selectedRowCount: 1,
    selectedRowsRoutingReady: true,
    preflightReady: false,
    preflightBlockers: ["Client cutover has not been approved."],
  });
  assert.equal(readiness.canApprove, false);
  assert.ok(readiness.remainingBlockers.some((b) => b.includes("Client cutover has not been approved")));
});

test("phrase alone does not enable approve when preflight fails", () => {
  const readiness = resolveApproveDeliveryReadiness({
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    eligibleSimulatedCount: 1,
    selectedRowCount: 1,
    selectedRowsRoutingReady: true,
    preflightReady: false,
    preflightBlockers: ["Worker/API dispatch configuration is unavailable."],
  });
  assert.equal(readiness.phraseAccepted, true);
  assert.equal(readiness.canApprove, false);
});
