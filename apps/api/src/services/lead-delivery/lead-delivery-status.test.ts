import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeliveryStatus,
  normalizeGhlContactStatus,
  normalizeRoutingStatus,
} from "./lead-delivery-status.js";

test("normalizeRoutingStatus maps unmatched source status", () => {
  assert.equal(
    normalizeRoutingStatus({ sourceStatus: "routing_unmatched", matched: false }),
    "unmatched"
  );
});

test("normalizeRoutingStatus maps review_required for needs_review", () => {
  assert.equal(normalizeRoutingStatus({ sourceStatus: "needs_review" }), "review_required");
});

test("normalizeDeliveryStatus maps delivered", () => {
  assert.equal(normalizeDeliveryStatus({ sourceStatus: "delivered" }), "delivered");
});

test("normalizeDeliveryStatus maps skipped for routing_unmatched", () => {
  assert.equal(normalizeDeliveryStatus({ sourceStatus: "routing_unmatched" }), "skipped");
});

test("normalizeGhlContactStatus returns not_created without contact id", () => {
  assert.equal(normalizeGhlContactStatus({}), "not_created");
});

test("normalizeGhlContactStatus returns created when contact id present", () => {
  assert.equal(normalizeGhlContactStatus({ contactIdGhl: "abc123" }), "created");
});
