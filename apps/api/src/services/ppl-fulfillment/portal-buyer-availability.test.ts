import assert from "node:assert/strict";
import test from "node:test";

import type { BuyerInventoryAvailabilityResult } from "./buyer-inventory-availability.service.js";
import {
  lookupPortalBuyerAvailability,
  portalAvailabilityDisplay,
  projectPortalBuyerAvailability,
  resetPortalBuyerAvailabilityCache,
} from "./portal-buyer-availability.js";

function report(
  overrides: Record<string, unknown> = {}
): Extract<BuyerInventoryAvailabilityResult, { ok: true }> {
  return {
    ok: true,
    evaluatedAt: "2026-10-19T15:00:00.000Z",
    nicheKey: "vet",
    states: ["TX", "CO"],
    requestedCommerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
    allAgedTiers: false,
    queryCompleteness: "complete",
    eligibleCountSemantics: "exact",
    ageTiers: [
      {
        commerceAgeBucketKey: "COMMERCE_1_3_MO",
        minDaysInclusive: 30,
        maxDaysExclusive: 90,
        eligible: 4,
        classified: 4,
        countSemantics: "exact",
      },
      {
        commerceAgeBucketKey: "COMMERCE_3_6_MO",
        minDaysInclusive: 90,
        maxDaysExclusive: 180,
        eligible: 2,
        classified: 2,
        countSemantics: "exact",
      },
    ],
    buyer: { clientAccountId: "buyer_secret", clientDisplayName: "Hidden Buyer" },
    structuralCohort: { rows: 99, unstampedNotReconcilable: 7 },
    exclusionReasons: { originUnresolved: { rows: 3 } },
    fingerprints: ["fp_secret"],
    ...overrides,
  } as unknown as Extract<BuyerInventoryAvailabilityResult, { ok: true }>;
}

test("exact, lower-bound, and not-reached tiers keep honest display semantics", () => {
  assert.equal(portalAvailabilityDisplay({ eligible: 4, countSemantics: "exact" }), "estimate");
  assert.equal(portalAvailabilityDisplay({ eligible: 2, countSemantics: "lower_bound" }), "at_least");
  assert.equal(portalAvailabilityDisplay({ eligible: null, countSemantics: "not_reached" }), "unknown");
  assert.equal(portalAvailabilityDisplay({ eligible: null, countSemantics: "exact" }), "unknown");
});

test("customer projection drops buyer identity, exclusions, and fingerprints", () => {
  const view = projectPortalBuyerAvailability(report(), {
    nicheKey: "vet",
    states: ["TX", "CO"],
    commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
    productType: null,
  });
  const encoded = JSON.stringify(view);
  assert.equal(view.reservesInventory, false);
  assert.equal(view.stateMatrix, null);
  assert.equal(view.buckets[0]?.display, "estimate");
  assert.equal(view.buckets[0]?.eligible, 4);
  assert.equal(encoded.includes("buyer_secret"), false);
  assert.equal(encoded.includes("Hidden Buyer"), false);
  assert.equal(encoded.includes("fp_secret"), false);
  assert.equal(encoded.includes("originUnresolved"), false);
  assert.equal(encoded.includes("structuralCohort"), false);
  assert.equal(encoded.includes("unstampedNotReconcilable"), false);
});

test("lower-bound and not-reached tiers are not rendered as exact zeros", () => {
  const view = projectPortalBuyerAvailability(
    report({
      queryCompleteness: "incomplete",
      eligibleCountSemantics: "lower_bound",
      ageTiers: [
        {
          commerceAgeBucketKey: "COMMERCE_6_9_MO",
          minDaysInclusive: 180,
          maxDaysExclusive: 270,
          eligible: 1,
          classified: 1,
          countSemantics: "lower_bound",
        },
        {
          commerceAgeBucketKey: "COMMERCE_12_MO_PLUS",
          minDaysInclusive: 365,
          maxDaysExclusive: null,
          eligible: null,
          classified: 0,
          countSemantics: "not_reached",
        },
      ],
    }),
    {
      nicheKey: "vet",
      states: ["TX"],
      commerceAgeBucketKeys: ["COMMERCE_6_9_MO", "COMMERCE_12_MO_PLUS"],
      productType: null,
    }
  );
  assert.equal(view.queryCompleteness, "incomplete");
  assert.equal(view.countSemantics, "lower_bound");
  assert.equal(view.buckets[0]?.display, "at_least");
  assert.equal(view.buckets[1]?.display, "unknown");
  assert.equal(view.buckets[1]?.eligible, null);
});

test("product filters fail closed and are not sent to the canonical lookup", async () => {
  let calls = 0;
  const result = await lookupPortalBuyerAvailability(
    {
      clientAccountId: "buyer_a",
      nicheKey: "vet",
      states: ["TX"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      productType: "exclusive",
    },
    {
      lookup: (async () => {
        calls += 1;
        return { ok: false, code: "should_not_run", reasons: [] };
      }) as never,
    }
  );
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "unsupported_filter");
    assert.deepEqual(result.reasons, ["product_type_not_supported", "filter_not_applied"]);
  }
});

test("availability cache is scoped to the authenticated buyer and does not cache failures", async () => {
  resetPortalBuyerAvailabilityCache();
  const seen: string[] = [];
  let fail = true;
  const lookup = (async (input: { clientAccountId: string }) => {
    seen.push(input.clientAccountId);
    if (fail) return { ok: false as const, code: "availability_snapshot_unavailable", reasons: ["timeout"] };
    return report();
  }) as never;

  const first = await lookupPortalBuyerAvailability(
    {
      clientAccountId: "buyer_a",
      nicheKey: "vet",
      states: ["CO", "TX"],
      commerceAgeBucketKeys: ["COMMERCE_3_6_MO", "COMMERCE_1_3_MO"],
      now: 1_000,
    },
    { lookup }
  );
  assert.equal(first.ok, false);
  fail = false;
  const second = await lookupPortalBuyerAvailability(
    {
      clientAccountId: "buyer_a",
      nicheKey: "vet",
      states: ["TX", "CO"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
      now: 2_000,
    },
    { lookup }
  );
  const third = await lookupPortalBuyerAvailability(
    {
      clientAccountId: "buyer_a",
      nicheKey: "vet",
      states: ["TX", "CO"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
      now: 3_000,
    },
    { lookup }
  );
  const otherBuyer = await lookupPortalBuyerAvailability(
    {
      clientAccountId: "buyer_b",
      nicheKey: "vet",
      states: ["TX", "CO"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
      now: 4_000,
    },
    { lookup }
  );
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.equal(otherBuyer.ok, true);
  assert.deepEqual(seen, ["buyer_a", "buyer_a", "buyer_b"]);
  resetPortalBuyerAvailabilityCache();
});
