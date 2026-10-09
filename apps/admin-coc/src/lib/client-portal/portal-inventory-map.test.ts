import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortalInventoryAvailability,
  isPortalInventoryMapEnabled,
  parsePortalInventoryAvailabilityQuery,
} from "./portal-inventory-map.ts";

const NOW = new Date("2026-10-09T14:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    nicheKey: "vet",
    productType: "exclusive",
    state: "TX",
    ageBandLabel: "31–60 days",
    inventoryClass: "lal",
    exclusivityMode: "exclusive",
    availabilityLabel: "Available" as const,
    unitPriceCents: null,
    evaluatedAt: NOW.toISOString(),
    ...overrides,
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

test("availability query rejects browser tenant overrides and invalid criteria", () => {
  assert.deepEqual(
    parsePortalInventoryAvailabilityQuery(
      new URLSearchParams({
        clientAccountId: "acct_other",
        nicheKey: "vet",
        requestedAgeBucket: "COMMERCE_1_3_MO",
        requestedQuantity: "100",
      })
    ),
    { ok: false, error: "clientAccountId cannot be supplied by the browser" }
  );
  assert.equal(
    parsePortalInventoryAvailabilityQuery(
      new URLSearchParams({
        nicheKey: "vet",
        requestedAgeBucket: "COMMERCE_6_9_MO",
        requestedQuantity: "0",
      })
    ).ok,
    false
  );
});

test("availability is filtered by niche, product and mapped age band without exposing counts", () => {
  const result = buildPortalInventoryAvailability({
    rows: [
      row(),
      row({ state: "CA", availabilityLabel: "Limited" }),
      row({ state: "OH", productType: "shared" }),
      row({ state: "FL", nicheKey: "nurse" }),
      row({ state: "PA", ageBandLabel: "91–180 days" }),
    ],
    evaluatedAt: NOW.toISOString(),
    nicheKey: "vet",
    productType: "exclusive",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    requestedQuantity: 250,
    now: NOW,
  });
  assert.equal(result.mappingSupported, true);
  assert.equal(result.stale, false);
  assert.deepEqual(
    result.states.filter((state) => state.availability !== "Currently unavailable"),
    [
      { state: "CA", availability: "Limited" },
      { state: "TX", availability: "Available" },
    ]
  );
  assert.equal(JSON.stringify(result).includes("count"), false);
  assert.equal(JSON.stringify(result).includes("inventoryClass"), false);
});

test("unsupported split age buckets do not fabricate availability", () => {
  const result = buildPortalInventoryAvailability({
    rows: [row({ ageBandLabel: "181–365 days" })],
    evaluatedAt: NOW.toISOString(),
    nicheKey: "vet",
    requestedAgeBucket: "COMMERCE_6_9_MO",
    requestedQuantity: 100,
    now: NOW,
  });
  assert.equal(result.mappingSupported, false);
  assert.deepEqual(result.states, []);
  assert.match(result.mappingNote, /cannot be shown safely/i);
});

test("missing and old evaluations are marked stale while empty mapped inventory is unavailable", () => {
  const result = buildPortalInventoryAvailability({
    rows: [],
    evaluatedAt: "2026-10-09T12:00:00.000Z",
    nicheKey: "vet",
    requestedAgeBucket: "COMMERCE_12_MO_PLUS",
    requestedQuantity: 100,
    now: NOW,
  });
  assert.equal(result.stale, true);
  assert.equal(result.mappingSupported, true);
  assert.ok(result.states.every((state) => state.availability === "Currently unavailable"));
});
