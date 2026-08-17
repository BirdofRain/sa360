import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isHoldInventoryCommerceLifecycle,
  isPurchasableInventoryCommerceLifecycle,
  resolveInventoryCommerceLifecycle,
} from "./commerce-lifecycle.js";

const BOUNDARIES: Array<[number, ReturnType<typeof resolveInventoryCommerceLifecycle>]> = [
  [0, "FRESH_HOLD"],
  [9, "FRESH_HOLD"],
  [10, "SEMI_FRESH_HOLD"],
  [29, "SEMI_FRESH_HOLD"],
  [30, "COMMERCE_1_3_MO"],
  [89, "COMMERCE_1_3_MO"],
  [90, "COMMERCE_3_6_MO"],
  [179, "COMMERCE_3_6_MO"],
  [180, "COMMERCE_6_9_MO"],
  [269, "COMMERCE_6_9_MO"],
  [270, "COMMERCE_9_12_MO"],
  [364, "COMMERCE_9_12_MO"],
  [365, "COMMERCE_12_MO_PLUS"],
];

test("commerce lifecycle exact day boundaries", () => {
  for (const [day, expected] of BOUNDARIES) {
    assert.equal(resolveInventoryCommerceLifecycle(day), expected, `day ${day}`);
  }
});

test("missing age is DATE_MISSING and not purchasable", () => {
  assert.equal(resolveInventoryCommerceLifecycle(null), "DATE_MISSING");
  assert.equal(isPurchasableInventoryCommerceLifecycle("DATE_MISSING"), false);
});

test("Fresh and Semi-Fresh HOLD are tracked but not purchasable", () => {
  assert.equal(isHoldInventoryCommerceLifecycle("FRESH_HOLD"), true);
  assert.equal(isHoldInventoryCommerceLifecycle("SEMI_FRESH_HOLD"), true);
  assert.equal(isPurchasableInventoryCommerceLifecycle("FRESH_HOLD"), false);
  assert.equal(isPurchasableInventoryCommerceLifecycle("SEMI_FRESH_HOLD"), false);
});

test("priced commerce buckets remain purchasable by lifecycle key alone", () => {
  assert.equal(isPurchasableInventoryCommerceLifecycle("COMMERCE_1_3_MO"), true);
  assert.equal(isPurchasableInventoryCommerceLifecycle("COMMERCE_12_MO_PLUS"), true);
});
