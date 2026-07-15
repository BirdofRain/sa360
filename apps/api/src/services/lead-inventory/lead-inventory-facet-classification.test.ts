import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertFacetCellInvariants,
  classifyInventoryFacetItem,
} from "./lead-inventory-facet-classification.js";
import type { LeadInventoryAvailabilityResult } from "./lead-inventory-availability.service.js";

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
