import { test } from "node:test";
import assert from "node:assert/strict";

import { isLeadInventoryReviewEnabled } from "./lead-inventory-review-env.js";

test("review feature flag defaults to disabled", () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  try {
    assert.equal(isLeadInventoryReviewEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("review feature flag accepts normalized true values", () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  try {
    for (const value of ["1", "true", "yes", "on", "TRUE", " Yes "]) {
      process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = value;
      assert.equal(isLeadInventoryReviewEnabled(), true, value);
    }
    process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "false";
    assert.equal(isLeadInventoryReviewEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});
