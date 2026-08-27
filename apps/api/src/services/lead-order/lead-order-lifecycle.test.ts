import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCanActivateOrder,
  assertCanApproveOrder,
  assertCanCreateWithStatus,
  DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS,
  paymentAllowsApproval,
  resolvePaymentConfirmationStatus,
} from "./lead-order-lifecycle.js";

test("new orders default to pending_confirmation, not inferred from prices", () => {
  assert.equal(DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS, "pending_confirmation");
  assert.equal(resolvePaymentConfirmationStatus(undefined), "pending_confirmation");
  assert.equal(resolvePaymentConfirmationStatus(null), "pending_confirmation");
  assert.equal(resolvePaymentConfirmationStatus(0), "pending_confirmation");
  assert.equal(paymentAllowsApproval("pending_confirmation"), false);
  assert.equal(paymentAllowsApproval("confirmed"), true);
  assert.equal(paymentAllowsApproval("not_required"), true);
});

test("submitted + pending payment cannot approve", () => {
  const check = assertCanApproveOrder({
    status: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.error, "payment_confirmation_required");
});

test("submitted + confirmed payment can approve", () => {
  const check = assertCanApproveOrder({
    status: "submitted",
    paymentConfirmationStatus: "confirmed",
  });
  assert.equal(check.ok, true);
});

test("submitted + not_required can approve", () => {
  const check = assertCanApproveOrder({
    status: "submitted",
    paymentConfirmationStatus: "not_required",
  });
  assert.equal(check.ok, true);
});

test("submitted cannot jump directly to active", () => {
  const check = assertCanActivateOrder({ status: "submitted" });
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.error, "submitted_cannot_activate");
    assert.ok(check.reasons.includes("activation_requires_ready"));
  }
});

test("ready can activate; paused can resume; active is idempotent", () => {
  assert.equal(assertCanActivateOrder({ status: "ready" }).ok, true);
  assert.equal(assertCanActivateOrder({ status: "paused" }).ok, true);
  assert.equal(assertCanActivateOrder({ status: "active" }).ok, true);
});

test("needs_setup and draft cannot activate", () => {
  assert.equal(assertCanActivateOrder({ status: "needs_setup" }).ok, false);
  assert.equal(assertCanActivateOrder({ status: "needs_compliance" }).ok, false);
  assert.equal(assertCanActivateOrder({ status: "draft" }).ok, false);
});

test("admin create cannot start as ready or active", () => {
  const ready = assertCanCreateWithStatus({ status: "ready" });
  const active = assertCanCreateWithStatus({ status: "active" });
  assert.equal(ready.ok, false);
  assert.equal(active.ok, false);
  if (!active.ok) assert.equal(active.error, "submitted_cannot_activate");
  assert.equal(assertCanCreateWithStatus({ status: "submitted" }).ok, true);
});

test("canceled orders cannot be approved", () => {
  const check = assertCanApproveOrder({
    status: "canceled",
    paymentConfirmationStatus: "confirmed",
  });
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.error, "order_not_approvable");
});
