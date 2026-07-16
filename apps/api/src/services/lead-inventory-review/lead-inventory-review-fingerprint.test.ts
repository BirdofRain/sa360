import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewSelectionFingerprint,
  normalizeReviewItemIds,
} from "./lead-inventory-review-fingerprint.js";

test("fingerprint is deterministic and order-independent", () => {
  const a = buildReviewSelectionFingerprint({
    actionType: "make_available",
    itemIds: ["b", "a", "a"],
    reasonCode: "review_passed",
  });
  const b = buildReviewSelectionFingerprint({
    actionType: "make_available",
    itemIds: ["a", "b"],
    reasonCode: "review_passed",
  });
  assert.equal(a, b);
  assert.equal(normalizeReviewItemIds(["b", "a", "a"]).join(","), "a,b");
});

test("fingerprint changes when action or reason changes", () => {
  const base = buildReviewSelectionFingerprint({
    actionType: "make_available",
    itemIds: ["a"],
    reasonCode: "review_passed",
  });
  const otherAction = buildReviewSelectionFingerprint({
    actionType: "reject",
    itemIds: ["a"],
    reasonCode: "operator_rejected",
  });
  const otherReason = buildReviewSelectionFingerprint({
    actionType: "quarantine",
    itemIds: ["a"],
    reasonCode: "operator_quarantine",
  });
  assert.notEqual(base, otherAction);
  assert.notEqual(base, otherReason);
});
