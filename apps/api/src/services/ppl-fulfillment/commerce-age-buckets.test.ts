import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ageDaysInCommerceBucket,
  parseCommerceAgeBucketKeys,
  resolveCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";

test("commerce age bucket boundaries resolve expected keys", () => {
  assert.equal(resolveCommerceAgeBucketKey(29), null);
  assert.equal(resolveCommerceAgeBucketKey(30), "COMMERCE_1_3_MO");
  assert.equal(resolveCommerceAgeBucketKey(89), "COMMERCE_1_3_MO");
  assert.equal(resolveCommerceAgeBucketKey(90), "COMMERCE_3_6_MO");
  assert.equal(resolveCommerceAgeBucketKey(179), "COMMERCE_3_6_MO");
  assert.equal(resolveCommerceAgeBucketKey(180), "COMMERCE_6_12_MO");
  assert.equal(resolveCommerceAgeBucketKey(364), "COMMERCE_6_12_MO");
  assert.equal(resolveCommerceAgeBucketKey(365), "COMMERCE_12_MO_PLUS");
  assert.equal(resolveCommerceAgeBucketKey(900), "COMMERCE_12_MO_PLUS");
});

test("ageDaysInCommerceBucket respects half-open intervals", () => {
  assert.equal(ageDaysInCommerceBucket(30, "COMMERCE_1_3_MO"), true);
  assert.equal(ageDaysInCommerceBucket(89, "COMMERCE_1_3_MO"), true);
  assert.equal(ageDaysInCommerceBucket(90, "COMMERCE_1_3_MO"), false);
  assert.equal(ageDaysInCommerceBucket(365, "COMMERCE_12_MO_PLUS"), true);
});

test("parseCommerceAgeBucketKeys dedupes and filters invalid values", () => {
  assert.deepEqual(
    parseCommerceAgeBucketKeys([
      "COMMERCE_1_3_MO",
      "invalid",
      "COMMERCE_1_3_MO",
      "COMMERCE_6_12_MO",
    ]),
    ["COMMERCE_1_3_MO", "COMMERCE_6_12_MO"]
  );
  assert.deepEqual(parseCommerceAgeBucketKeys("COMMERCE_1_3_MO"), []);
});
