import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computePplLineTotalCents,
  isHoldPplBucket,
  isPurchasablePplAgedBucket,
  listActivePplAgedPrices,
  PPL_AGED_PRICING_VERSION,
  PPL_HOLD_AGE_BUCKETS,
  resolvePplAgedUnitPriceCents,
} from "./ppl-aged-pricing.registry.js";

describe("ppl aged pricing registry", () => {
  it("exposes confirmed beta aged unit prices", () => {
    const byKey = Object.fromEntries(
      listActivePplAgedPrices().map((row) => [row.key, row.unitPriceCents])
    );
    assert.equal(byKey.COMMERCE_1_3_MO, 600);
    assert.equal(byKey.COMMERCE_3_6_MO, 400);
    assert.equal(byKey.COMMERCE_6_9_MO, 300);
    assert.equal(byKey.COMMERCE_9_12_MO, 200);
    assert.equal(byKey.COMMERCE_12_MO_PLUS, 100);
    assert.equal(PPL_AGED_PRICING_VERSION, "ppl_aged_beta_2026_08_v1");
  });

  it("keeps Fresh / Semi-Fresh on HOLD and non-purchasable", () => {
    assert.deepEqual(
      PPL_HOLD_AGE_BUCKETS.map((row) => [row.key, row.status, row.workingTargetCents]),
      [
        ["FRESH", "HOLD", 1500],
        ["SEMI_FRESH", "HOLD", 1200],
      ]
    );
    assert.equal(isHoldPplBucket("FRESH"), true);
    assert.equal(isPurchasablePplAgedBucket("FRESH"), false);
    assert.equal(resolvePplAgedUnitPriceCents({ commerceAgeBucketKey: "FRESH" }).ok, false);
    assert.equal(resolvePplAgedUnitPriceCents({ commerceAgeBucketKey: "SEMI_FRESH" }).ok, false);
  });

  it("computes line totals as quantity × unit price", () => {
    assert.equal(computePplLineTotalCents(100, 400), 40_000);
    assert.equal(computePplLineTotalCents(87, 400), 34_800);
  });
});
