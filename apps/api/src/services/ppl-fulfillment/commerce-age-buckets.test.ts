import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ageDaysInCommerceBucket,
  expandCommerceAgeBucketRanges,
  generatedAtFilterForCommerceAgeRanges,
  parseCommerceAgeBucketKeys,
  resolveCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";

test("commerce age bucket boundaries resolve expected keys at 30/90/180/270/365", () => {
  assert.equal(resolveCommerceAgeBucketKey(29), null);
  assert.equal(resolveCommerceAgeBucketKey(30), "COMMERCE_1_3_MO");
  assert.equal(resolveCommerceAgeBucketKey(89), "COMMERCE_1_3_MO");
  assert.equal(resolveCommerceAgeBucketKey(90), "COMMERCE_3_6_MO");
  assert.equal(resolveCommerceAgeBucketKey(179), "COMMERCE_3_6_MO");
  assert.equal(resolveCommerceAgeBucketKey(180), "COMMERCE_6_9_MO");
  assert.equal(resolveCommerceAgeBucketKey(269), "COMMERCE_6_9_MO");
  assert.equal(resolveCommerceAgeBucketKey(270), "COMMERCE_9_12_MO");
  assert.equal(resolveCommerceAgeBucketKey(364), "COMMERCE_9_12_MO");
  assert.equal(resolveCommerceAgeBucketKey(365), "COMMERCE_12_MO_PLUS");
  assert.equal(resolveCommerceAgeBucketKey(900), "COMMERCE_12_MO_PLUS");
});

test("resolve never emits legacy COMMERCE_6_12_MO", () => {
  for (const day of [180, 200, 270, 300, 364]) {
    assert.notEqual(resolveCommerceAgeBucketKey(day), "COMMERCE_6_12_MO");
  }
});

test("ageDaysInCommerceBucket respects half-open intervals", () => {
  assert.equal(ageDaysInCommerceBucket(30, "COMMERCE_1_3_MO"), true);
  assert.equal(ageDaysInCommerceBucket(89, "COMMERCE_1_3_MO"), true);
  assert.equal(ageDaysInCommerceBucket(90, "COMMERCE_1_3_MO"), false);
  assert.equal(ageDaysInCommerceBucket(180, "COMMERCE_6_9_MO"), true);
  assert.equal(ageDaysInCommerceBucket(270, "COMMERCE_6_9_MO"), false);
  assert.equal(ageDaysInCommerceBucket(270, "COMMERCE_9_12_MO"), true);
  assert.equal(ageDaysInCommerceBucket(365, "COMMERCE_12_MO_PLUS"), true);
  assert.equal(ageDaysInCommerceBucket(200, "COMMERCE_6_12_MO"), true);
  assert.equal(ageDaysInCommerceBucket(365, "COMMERCE_6_12_MO"), false);
});

test("parseCommerceAgeBucketKeys accepts new keys and legacy COMMERCE_6_12_MO", () => {
  assert.deepEqual(
    parseCommerceAgeBucketKeys([
      "COMMERCE_1_3_MO",
      "invalid",
      "COMMERCE_1_3_MO",
      "COMMERCE_6_9_MO",
      "COMMERCE_6_12_MO",
    ]),
    ["COMMERCE_1_3_MO", "COMMERCE_6_9_MO", "COMMERCE_6_12_MO"]
  );
  assert.deepEqual(parseCommerceAgeBucketKeys("COMMERCE_1_3_MO"), []);
});

test("generatedAtFilterForCommerceAgeRanges matches floor age-day semantics", () => {
  const evaluatedAt = new Date("2026-08-12T12:00:00.000Z");
  const ranges = expandCommerceAgeBucketRanges(["COMMERCE_1_3_MO"]);
  const filters = generatedAtFilterForCommerceAgeRanges(ranges, evaluatedAt);
  assert.equal(filters.length, 1);
  const filter = filters[0]!;
  assert.ok(filter.gt);
  assert.ok(filter.lte);
  // Day 30 inclusive → generatedAt <= eval - 30d
  assert.equal(
    filter.lte.toISOString(),
    new Date(evaluatedAt.getTime() - 30 * 86400000).toISOString()
  );
  // Day < 90 → generatedAt > eval - 90d
  assert.equal(
    filter.gt!.toISOString(),
    new Date(evaluatedAt.getTime() - 90 * 86400000).toISOString()
  );
});
