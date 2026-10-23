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

  it("does not add older buckets when older-lead consent is recorded", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: ["COMMERCE_12_MO_PLUS"],
      pricedCommerceAgeBucketKey: "COMMERCE_1_3_MO",
      shortfallPolicy: "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.code, "priced_bucket_mismatch");
    assert.ok(resolved.reasons.includes("older_lead_consent:yes"));
  });

  it("does not treat missing older-lead consent as permission to leave the priced bucket", () => {
    const resolved = resolveSelectionCommerceBuckets({
      requestBuckets: ["COMMERCE_12_MO_PLUS"],
      pricedCommerceAgeBucketKey: "COMMERCE_1_3_MO",
      shortfallPolicy: null,
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.code, "priced_bucket_mismatch");
    assert.ok(resolved.reasons.includes("older_lead_consent:no"));
  });

  it("locks a portal 6–12 order to the union of 6–9 and 9–12", () => {
    for (const requestBuckets of [
      [] as const,
      ["COMMERCE_6_12_MO"] as const,
      ["COMMERCE_9_12_MO", "COMMERCE_6_9_MO"] as const,
    ]) {
      const resolved = resolveSelectionCommerceBuckets({
        requestBuckets: [...requestBuckets],
        pricedCommerceAgeBucketKey: null,
        portalSelectionLock: ["COMMERCE_6_12_MO"],
        shortfallPolicy: "REFUND_UNFILLED",
      });
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.deepEqual(resolved.commerceAgeBucketKeys, ["COMMERCE_6_12_MO"]);
    }
  });

  it("rejects a partial or older bucket on a 6–12 order even with consent", () => {
    for (const requestBuckets of [
      ["COMMERCE_6_9_MO"],
      ["COMMERCE_3_6_MO"],
      ["COMMERCE_12_MO_PLUS"],
    ] as const) {
      const resolved = resolveSelectionCommerceBuckets({
        requestBuckets: [...requestBuckets],
        pricedCommerceAgeBucketKey: null,
        portalSelectionLock: ["COMMERCE_6_12_MO"],
        shortfallPolicy: "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
      });
      assert.equal(resolved.ok, false, requestBuckets.join(","));
      if (resolved.ok) return;
      assert.equal(resolved.code, "priced_bucket_mismatch");
      assert.ok(resolved.reasons.includes("selection_bucket_must_match_portal_age_union"));
    }
  });
});
