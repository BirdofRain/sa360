import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateInventoryReservationInvariant,
  getActiveInventoryLinkedAllocations,
} from "./lead-inventory-allocation-invariant.service.js";

test("exclusive inventory allows historical allocations but not multiple active holds", () => {
  const active = getActiveInventoryLinkedAllocations([
    { id: "a1", status: "released", leadInventoryItemId: "item_1", releasedAt: new Date() },
    { id: "a2", status: "reserved", leadInventoryItemId: "item_1", releasedAt: null },
  ]);
  assert.equal(active.length, 1);

  const valid = evaluateInventoryReservationInvariant({
    exclusivityMode: "exclusive",
    maxFulfillments: 1,
    fulfillmentCount: 0,
    allocations: [
      { id: "a1", status: "released", leadInventoryItemId: "item_1", releasedAt: new Date() },
      { id: "a2", status: "reserved", leadInventoryItemId: "item_1", releasedAt: null },
    ],
  });
  assert.equal(valid.valid, true);

  const invalid = evaluateInventoryReservationInvariant({
    exclusivityMode: "exclusive",
    maxFulfillments: 1,
    fulfillmentCount: 0,
    allocations: [
      { id: "a1", status: "reserved", leadInventoryItemId: "item_1", releasedAt: null },
      { id: "a2", status: "committed", leadInventoryItemId: "item_1", releasedAt: null },
    ],
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.violations.includes("exclusive_multiple_active_holds"));
});

test("shared inventory allows multiple active holds up to remaining capacity", () => {
  const result = evaluateInventoryReservationInvariant({
    exclusivityMode: "shared",
    maxFulfillments: 3,
    fulfillmentCount: 1,
    allocations: [
      { id: "a1", status: "reserved", leadInventoryItemId: "item_1", releasedAt: null },
      { id: "a2", status: "committed", leadInventoryItemId: "item_1", releasedAt: null },
    ],
  });
  assert.equal(result.valid, true);
  assert.equal(result.remainingCapacity, 0);

  const exceeded = evaluateInventoryReservationInvariant({
    exclusivityMode: "shared",
    maxFulfillments: 2,
    fulfillmentCount: 1,
    allocations: [
      { id: "a1", status: "reserved", leadInventoryItemId: "item_1", releasedAt: null },
      { id: "a2", status: "committed", leadInventoryItemId: "item_1", releasedAt: null },
    ],
  });
  assert.equal(exceeded.valid, false);
  assert.ok(exceeded.violations.includes("fulfillment_capacity_exceeded"));
});

test("legacy allocations without inventory linkage remain outside inventory hold checks", () => {
  const active = getActiveInventoryLinkedAllocations([
    { id: "legacy", status: "reserved", leadInventoryItemId: null, releasedAt: null },
  ]);
  assert.equal(active.length, 0);
});
