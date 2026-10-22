import assert from "node:assert/strict";
import test from "node:test";

import {
  isPortalInventoryMapEnabled,
  parsePortalInventoryAvailabilityQuery,
  portalAvailabilityBand,
  portalBuyerMapUnavailable,
  projectPortalBuyerMapAvailability,
  PORTAL_BUYER_AVAILABILITY_POLICY,
  PORTAL_MAP_CANONICAL_STATES,
  type PortalBuyerAvailabilitySnapshot,
} from "./portal-inventory-map.ts";

const NOW = new Date("2026-10-22T18:00:00.000Z");

function snapshot(
  eligibleByState: PortalBuyerAvailabilitySnapshot["eligibleByState"]
): PortalBuyerAvailabilitySnapshot {
  return {
    clientAccountId: "buyer-a",
    policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
    nicheKey: "trucker",
    commerceAgeBucketKey: "COMMERCE_6_12_MO",
    states: [...PORTAL_MAP_CANONICAL_STATES],
    evaluatedAt: "2026-10-22T17:50:00.000Z",
    eligibleByState,
  };
}

test("portal inventory map feature flag defaults off and only accepts true", () => {
  assert.equal(isPortalInventoryMapEnabled({}), false);
  assert.equal(
    isPortalInventoryMapEnabled({ SA360_PORTAL_INVENTORY_MAP_ENABLED: "false" }),
    false
  );
  assert.equal(
    isPortalInventoryMapEnabled({ SA360_PORTAL_INVENTORY_MAP_ENABLED: " TRUE " }),
    true
  );
});

test("availability query accepts 6–12 and rejects a browser tenant override", () => {
  assert.deepEqual(
    parsePortalInventoryAvailabilityQuery(
      new URLSearchParams({
        clientAccountId: "acct_other",
        nicheKey: "trucker",
        requestedAgeBucket: "COMMERCE_6_12_MO",
        requestedQuantity: "100",
      })
    ),
    { ok: false, error: "clientAccountId cannot be supplied by the browser" }
  );
  const parsed = parsePortalInventoryAvailabilityQuery(
    new URLSearchParams({
      nicheKey: "trucker",
      productType: "exclusive",
      requestedAgeBucket: "COMMERCE_6_12_MO",
      requestedQuantity: "25",
    })
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.requestedAgeBucket, "COMMERCE_6_12_MO");
  assert.equal("productType" in parsed.value, false);
  assert.equal(
    parsePortalInventoryAvailabilityQuery(
      new URLSearchParams({
        nicheKey: "trucker",
        requestedAgeBucket: "COMMERCE_6_12_MO",
        requestedQuantity: "0",
      })
    ).ok,
    false
  );
});

test("availability bands use one threshold and do not treat unknown as zero", () => {
  assert.equal(
    portalAvailabilityBand({ eligible: 25, countSemantics: "exact", requestedQuantity: 25 }),
    "Available"
  );
  assert.equal(
    portalAvailabilityBand({ eligible: 25, countSemantics: "lower_bound", requestedQuantity: 25 }),
    "Available"
  );
  assert.equal(
    portalAvailabilityBand({ eligible: 4, countSemantics: "exact", requestedQuantity: 25 }),
    "Limited"
  );
  assert.equal(
    portalAvailabilityBand({ eligible: 4, countSemantics: "lower_bound", requestedQuantity: 25 }),
    null
  );
  assert.equal(
    portalAvailabilityBand({ eligible: 0, countSemantics: "exact", requestedQuantity: 25 }),
    "Currently unavailable"
  );
  assert.equal(
    portalAvailabilityBand({ eligible: null, countSemantics: "not_reached", requestedQuantity: 25 }),
    null
  );
  assert.equal(
    portalAvailabilityBand({ eligible: 0, countSemantics: "not_reached", requestedQuantity: 25 }),
    null
  );
});

test("a buyer snapshot projects bands without exposing eligible counts", () => {
  const result = projectPortalBuyerMapAvailability({
    snapshot: snapshot([
      { state: "TX", eligible: 25, countSemantics: "exact" },
      { state: "FL", eligible: 4, countSemantics: "exact" },
      { state: "GA", eligible: 0, countSemantics: "exact" },
      { state: "AL", eligible: null, countSemantics: "not_reached" },
    ]),
    requestedQuantity: 25,
    now: NOW,
  });
  assert.equal(result.lookupStatus, "ready");
  assert.equal(result.stale, false);
  assert.equal(result.criteria.requestedAgeBucket, "COMMERCE_6_12_MO");
  assert.deepEqual(result.states, [
    { state: "TX", availability: "Available" },
    { state: "FL", availability: "Limited" },
    { state: "GA", availability: "Currently unavailable" },
    { state: "AL", availability: null },
  ]);
  const json = JSON.stringify(result);
  assert.equal(json.includes("eligibleByState"), false);
  assert.equal(json.includes("countSemantics"), false);
  assert.equal(json.includes("\"eligible\""), false);
});

test("old evaluations are stale and a disabled lookup has no state colors", () => {
  const stale = projectPortalBuyerMapAvailability({
    snapshot: snapshot([{ state: "TX", eligible: 10, countSemantics: "exact" }]),
    requestedQuantity: 1,
    now: new Date("2026-10-22T18:40:00.000Z"),
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.states[0]?.availability, "Available");

  const disabled = portalBuyerMapUnavailable({
    nicheKey: "trucker",
    requestedAgeBucket: "COMMERCE_6_12_MO",
    requestedQuantity: 25,
    lookupStatus: "disabled",
  });
  assert.equal(disabled.mappingSupported, false);
  assert.equal(disabled.evaluatedAt, null);
  assert.deepEqual(disabled.states, []);
  assert.match(disabled.mappingNote, /Availability lookup is disabled/);
});
