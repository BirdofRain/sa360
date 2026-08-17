import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSelectionCommerceBuckets } from "./priced-bucket-enforcement.js";

describe("priced bucket enforcement", () => {
  it("allows request buckets for legacy/demo orders without priced lines", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
      pricedCommerceAgeBucketKey: null,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.commerceAgeBucketKeys, ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"]);
  });

  it("locks selection to the priced order bucket", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: [],
      pricedCommerceAgeBucketKey: "COMMERCE_12_MO_PLUS",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.commerceAgeBucketKeys, ["COMMERCE_12_MO_PLUS"]);
  });

  it("locks replacement to the snapshotted priced bucket", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: [],
      pricedCommerceAgeBucketKey: "COMMERCE_9_12_MO",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.commerceAgeBucketKeys, ["COMMERCE_9_12_MO"]);
  });

  it("rejects priced replacement from a different commerce bucket", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: ["COMMERCE_1_3_MO"],
      pricedCommerceAgeBucketKey: "COMMERCE_9_12_MO",
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.code, "priced_bucket_mismatch");
  });

  it("rejects selection override of a $1 12+ order with $6 1–3 inventory", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: ["COMMERCE_1_3_MO"],
      pricedCommerceAgeBucketKey: "COMMERCE_12_MO_PLUS",
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.code, "priced_bucket_mismatch");
  });
});
