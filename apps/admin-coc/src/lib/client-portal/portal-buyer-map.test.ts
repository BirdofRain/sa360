import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_BUYER_AVAILABILITY_POLICY,
  PORTAL_MAP_CANONICAL_STATES,
  type PortalBuyerAvailabilitySnapshot,
} from "./portal-inventory-map.ts";
import {
  clearPortalBuyerAvailabilityCache,
  readCachedPortalBuyerAvailability,
  writeCachedPortalBuyerAvailability,
  portalBuyerAvailabilityCacheKey,
} from "./portal-buyer-availability-cache.ts";
import { loadPortalBuyerMapAvailability } from "./portal-buyer-map.ts";

const PRICED_KEY = "COMMERCE_6_9_MO" as const;

function snapshot(clientAccountId = "buyer-a"): PortalBuyerAvailabilitySnapshot {
  const states = [...PORTAL_MAP_CANONICAL_STATES];
  return {
    clientAccountId,
    policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
    nicheKey: "trucker",
    commerceAgeBucketKey: PRICED_KEY,
    states,
    evaluatedAt: "2026-10-22T17:55:00.000Z",
    eligibleByState: states.map((state) => ({
      state,
      eligible: state === "TX" ? 30 : state === "FL" ? 4 : state === "GA" ? 0 : null,
      countSemantics:
        state === "AL" ? "not_reached" : ("exact" as const),
    })),
  };
}

test("cache key isolates buyer, policy, niche, and priced age, and omits quantity", () => {
  clearPortalBuyerAvailabilityCache();
  const states = [...PORTAL_MAP_CANONICAL_STATES];
  const buyerA = portalBuyerAvailabilityCacheKey({
    clientAccountId: "buyer-a",
    policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
    nicheKey: "trucker",
    commerceAgeBucketKey: PRICED_KEY,
    states,
  });
  const buyerB = portalBuyerAvailabilityCacheKey({
    clientAccountId: "buyer-b",
    policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
    nicheKey: "trucker",
    commerceAgeBucketKey: PRICED_KEY,
    states,
  });
  const otherAge = portalBuyerAvailabilityCacheKey({
    clientAccountId: "buyer-a",
    policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
    nicheKey: "trucker",
    commerceAgeBucketKey: "COMMERCE_1_3_MO",
    states,
  });
  assert.equal(buyerA.split("\u0000").length, 5);
  assert.notEqual(buyerA, buyerB);
  assert.notEqual(buyerA, otherAge);
  writeCachedPortalBuyerAvailability(buyerA, snapshot("buyer-a"), 1_000);
  assert.equal(
    readCachedPortalBuyerAvailability(
      buyerA,
      {
        clientAccountId: "buyer-b",
        policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
        nicheKey: "trucker",
        commerceAgeBucketKey: PRICED_KEY,
      },
      1_100
    ),
    null
  );
  assert.equal(
    readCachedPortalBuyerAvailability(
      buyerA,
      {
        clientAccountId: "buyer-a",
        policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
        nicheKey: "trucker",
        commerceAgeBucketKey: PRICED_KEY,
      },
      1_100
    )?.clientAccountId,
    "buyer-a"
  );
});

test("successful lookups are cached per buyer and quantity only recomputes bands", async () => {
  clearPortalBuyerAvailabilityCache();
  let calls = 0;
  const fetchSnapshot = async (query: { clientAccountId: string; commerceAgeBucketKey: string }) => {
    calls += 1;
    assert.equal(query.commerceAgeBucketKey, PRICED_KEY);
    return { ok: true as const, snapshot: snapshot(query.clientAccountId) };
  };
  const now = new Date("2026-10-22T18:00:00.000Z");
  const first = await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-a",
    nicheKey: "trucker",
    requestedAgeBucket: PRICED_KEY,
    requestedQuantity: 10,
    now,
    fetchSnapshot,
  });
  const second = await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-a",
    nicheKey: "trucker",
    requestedAgeBucket: PRICED_KEY,
    requestedQuantity: 40,
    now,
    fetchSnapshot,
  });
  const otherBuyer = await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-b",
    nicheKey: "trucker",
    requestedAgeBucket: PRICED_KEY,
    requestedQuantity: 10,
    now,
    fetchSnapshot,
  });
  assert.equal(calls, 2);
  assert.equal(first.ok && first.availability.states.find((row) => row.state === "TX")?.availability, "Available");
  assert.equal(second.ok && second.availability.states.find((row) => row.state === "TX")?.availability, "Limited");
  assert.equal(second.ok && second.availability.criteria.requestedQuantity, 40);
  assert.equal(second.ok && second.availability.states.find((row) => row.state === "GA")?.availability, "Currently unavailable");
  assert.equal(second.ok && second.availability.states.find((row) => row.state === "AL")?.availability, null);
  assert.equal(otherBuyer.ok && otherBuyer.availability.criteria.nicheKey, "trucker");

  let disabledCalls = 0;
  const disabledFetch = async () => {
    disabledCalls += 1;
    return { ok: false as const, status: 404, code: "buyer_inventory_availability_disabled" };
  };
  const disabled = await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-a",
    nicheKey: "vet",
    requestedAgeBucket: "COMMERCE_9_12_MO",
    requestedQuantity: 10,
    now,
    fetchSnapshot: disabledFetch,
  });
  await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-a",
    nicheKey: "vet",
    requestedAgeBucket: "COMMERCE_9_12_MO",
    requestedQuantity: 10,
    now,
    fetchSnapshot: disabledFetch,
  });
  assert.equal(disabledCalls, 2);
  assert.equal(disabled.ok && disabled.availability.lookupStatus, "disabled");
  assert.deepEqual(disabled.ok && disabled.availability.states, []);

  let errorCalls = 0;
  const errorFetch = async () => {
    errorCalls += 1;
    return { ok: false as const, status: 503, code: "availability_snapshot_unavailable" };
  };
  const error = await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-a",
    nicheKey: "nurse",
    requestedAgeBucket: "COMMERCE_12_MO_PLUS",
    requestedQuantity: 10,
    now,
    fetchSnapshot: errorFetch,
  });
  await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-a",
    nicheKey: "nurse",
    requestedAgeBucket: "COMMERCE_12_MO_PLUS",
    requestedQuantity: 10,
    now,
    fetchSnapshot: errorFetch,
  });
  assert.equal(errorCalls, 2);
  assert.equal(error.ok, false);

  const mismatched = await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-c",
    nicheKey: "trucker",
    requestedAgeBucket: PRICED_KEY,
    requestedQuantity: 10,
    now,
    fetchSnapshot: async () => ({ ok: true, snapshot: snapshot("buyer-other") }),
  });
  assert.equal(mismatched.ok && mismatched.availability.lookupStatus, "unavailable");
  assert.deepEqual(mismatched.ok && mismatched.availability.states, []);
  let mismatchCalls = 0;
  await loadPortalBuyerMapAvailability({
    clientAccountId: "buyer-c",
    nicheKey: "trucker",
    requestedAgeBucket: PRICED_KEY,
    requestedQuantity: 10,
    now,
    fetchSnapshot: async () => {
      mismatchCalls += 1;
      return { ok: true, snapshot: snapshot("buyer-other") };
    },
  });
  assert.equal(mismatchCalls, 1);
});
