import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertFacetCellInvariants,
  classifyInventoryFacetItem,
} from "./lead-inventory-facet-classification.js";
import type { LeadInventoryAvailabilityResult } from "./lead-inventory-availability.service.js";
import type { InventoryLinkedAllocation } from "./lead-inventory-allocation-invariant.service.js";
import { hasActiveInventoryLinkedHold } from "./lead-inventory-allocation-invariant.service.js";

function availability(overrides: Partial<LeadInventoryAvailabilityResult> = {}): LeadInventoryAvailabilityResult {
  return {
    inventoryItemId: "item_1",
    generatedAt: "2026-07-01T00:00:00.000Z",
    ageDays: 5,
    ageBandKey: "FRESH_0_7",
    normalizedState: "NC",
    inventoryClass: "aged",
    nicheKey: "VET",
    proofStatus: "PROOF_ATTACHED",
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
    reservationStatus: "none",
    itemStatus: "available",
    available: true,
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

function alloc(
  overrides: Partial<InventoryLinkedAllocation> & Pick<InventoryLinkedAllocation, "id" | "status">
): InventoryLinkedAllocation {
  return {
    leadInventoryItemId: "item_1",
    releasedAt: null,
    ...overrides,
  };
}

/** Mirrors SQL facet bucketing: has_hold → reserved; else available/blocked from readiness. */
function bucketFromHoldAndAvailability(input: {
  allocations: InventoryLinkedAllocation[];
  availableWithoutHold: boolean;
}): { category: "available" | "reserved" | "blocked"; hasHold: boolean } {
  const hasHold = hasActiveInventoryLinkedHold(input.allocations);
  if (hasHold) return { category: "reserved", hasHold };
  if (input.availableWithoutHold) return { category: "available", hasHold };
  return { category: "blocked", hasHold };
}

test("reserved item is not blocked", () => {
  const category = classifyInventoryFacetItem({
    availability: availability({ available: false, blockers: ["active_reservation"] }),
    inventoryLinkedAllocations: [
      { id: "a1", status: "reserved", leadInventoryItemId: "item_1", releasedAt: null },
    ],
  });
  assert.equal(category, "reserved");
});

test("proof-blocked item is blocked and not supply", () => {
  const category = classifyInventoryFacetItem({
    availability: availability({ available: false, blockers: ["proof_not_ready"] }),
    inventoryLinkedAllocations: [],
  });
  assert.equal(category, "blocked");
});

test("facet cell invariants hold for available, reserved, and blocked mix", () => {
  const cell = { total: 10, available: 4, reserved: 3, blocked: 3, supply: 7 };
  assert.equal(assertFacetCellInvariants(cell), true);
  assert.equal(cell.total, cell.available + cell.reserved + cell.blocked);
  assert.equal(cell.supply, cell.available + cell.reserved);
});

test("hold fixtures: no allocation preserves available", () => {
  const allocations: InventoryLinkedAllocation[] = [];
  const { category, hasHold } = bucketFromHoldAndAvailability({
    allocations,
    availableWithoutHold: true,
  });
  assert.equal(hasHold, false);
  assert.equal(category, "available");
  assert.equal(
    classifyInventoryFacetItem({
      availability: availability({ available: true }),
      inventoryLinkedAllocations: allocations,
    }),
    "available"
  );
});

test("hold fixtures: one active allocation makes item reserved", () => {
  const allocations = [alloc({ id: "a1", status: "reserved" })];
  const { category, hasHold } = bucketFromHoldAndAvailability({
    allocations,
    availableWithoutHold: true,
  });
  assert.equal(hasHold, true);
  assert.equal(category, "reserved");
  assert.equal(
    classifyInventoryFacetItem({
      availability: availability({ available: false, blockers: ["active_reservation"] }),
      inventoryLinkedAllocations: allocations,
    }),
    "reserved"
  );
});

test("hold fixtures: multiple active allocations still count once as reserved", () => {
  const allocations = [
    alloc({ id: "a1", status: "reserved" }),
    alloc({ id: "a2", status: "committed" }),
    alloc({ id: "a3", status: "delivering" }),
  ];
  assert.equal(hasActiveInventoryLinkedHold(allocations), true);
  assert.equal(
    bucketFromHoldAndAvailability({ allocations, availableWithoutHold: true }).category,
    "reserved"
  );
});

test("hold fixtures: mixed active and inactive still reserved once", () => {
  const allocations = [
    alloc({ id: "a1", status: "reserved" }),
    alloc({ id: "a2", status: "shadow" }),
    alloc({ id: "a3", status: "released" }),
  ];
  assert.equal(hasActiveInventoryLinkedHold(allocations), true);
  assert.equal(
    bucketFromHoldAndAvailability({ allocations, availableWithoutHold: true }).category,
    "reserved"
  );
});

test("hold fixtures: inactive/shadow allocations only do not reserve", () => {
  // Non-active LeadAllocationStatus values: shadow, released (failed/cancelled/expired are not enum members)
  const allocations = [
    alloc({ id: "a1", status: "shadow" }),
    alloc({ id: "a2", status: "released" }),
  ];
  assert.equal(hasActiveInventoryLinkedHold(allocations), false);
  assert.equal(
    bucketFromHoldAndAvailability({ allocations, availableWithoutHold: true }).category,
    "available"
  );
});

test("hold fixtures: null leadInventoryItemId does not count as active hold", () => {
  const allocations = [
    alloc({ id: "a1", status: "reserved", leadInventoryItemId: null }),
    alloc({ id: "a2", status: "committed", leadInventoryItemId: null }),
  ];
  assert.equal(hasActiveInventoryLinkedHold(allocations), false);
  assert.equal(
    bucketFromHoldAndAvailability({ allocations, availableWithoutHold: true }).category,
    "available"
  );
});

test("hold fixtures: unrelated items do not share holds", () => {
  const itemA = [alloc({ id: "a1", status: "reserved", leadInventoryItemId: "item_a" })];
  const itemB: InventoryLinkedAllocation[] = [];
  assert.equal(hasActiveInventoryLinkedHold(itemA), true);
  assert.equal(hasActiveInventoryLinkedHold(itemB), false);
  assert.equal(
    bucketFromHoldAndAvailability({ allocations: itemB, availableWithoutHold: true }).category,
    "available"
  );
});

test("hold fixtures: duplicate active rows do not change reserved category", () => {
  const once = [alloc({ id: "a1", status: "review_required" })];
  const dupes = [
    alloc({ id: "a1", status: "review_required" }),
    alloc({ id: "a2", status: "review_required" }),
  ];
  assert.equal(
    bucketFromHoldAndAvailability({ allocations: once, availableWithoutHold: true }).category,
    "reserved"
  );
  assert.equal(
    bucketFromHoldAndAvailability({ allocations: dupes, availableWithoutHold: true }).category,
    "reserved"
  );
});

test("hold fixtures: cell totals preserve total = available + reserved + blocked", () => {
  const cells = [
    { total: 1, available: 1, reserved: 0, blocked: 0, supply: 1 },
    { total: 1, available: 0, reserved: 1, blocked: 0, supply: 1 },
    { total: 1, available: 0, reserved: 0, blocked: 1, supply: 0 },
    { total: 5, available: 2, reserved: 1, blocked: 2, supply: 3 },
  ];
  for (const cell of cells) {
    assert.equal(assertFacetCellInvariants(cell), true);
    assert.equal(cell.total, cell.available + cell.reserved + cell.blocked);
  }
});
