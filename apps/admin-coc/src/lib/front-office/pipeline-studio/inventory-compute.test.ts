import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampRequestedQuantity,
  computeFulfillmentStatus,
  computeFullOrdersPossible,
  deriveInventoryExplorer,
  filteredAvailableForState,
} from "./inventory-compute";
import { getInventoryExplorerFixture } from "./inventory-fixtures";
import { INVENTORY_EXPLORER_NOTICE } from "./inventory-types";

describe("inventory explorer compute", () => {
  it("clamps requested quantity to a positive demo range", () => {
    assert.equal(clampRequestedQuantity(0), 1);
    assert.equal(clampRequestedQuantity(-5), 1);
    assert.equal(clampRequestedQuantity(12.9), 12);
    assert.equal(clampRequestedQuantity(99999), 5000);
  });

  it("sums selected age buckets for known states", () => {
    const counts = { "1_3": 16, "3_6": 23, "6_plus": 134 };
    assert.equal(
      filteredAvailableForState(counts, ["6_plus"], "known"),
      134
    );
    assert.equal(
      filteredAvailableForState(counts, ["1_3", "3_6"], "known"),
      39
    );
    assert.equal(
      filteredAvailableForState(counts, ["6_plus"], "unknown"),
      0
    );
  });

  it("applies fulfillment thresholds including NC/VA examples", () => {
    assert.equal(computeFulfillmentStatus(134, 100, "known"), "available");
    assert.equal(computeFulfillmentStatus(221, 100, "known"), "strong");
    assert.equal(computeFulfillmentStatus(23, 100, "known"), "custom_review");
    assert.equal(computeFulfillmentStatus(25, 100, "known"), "partial");
    assert.equal(computeFulfillmentStatus(0, 100, "known"), "unavailable");
    assert.equal(computeFulfillmentStatus(0, 100, "unknown"), "unknown");
  });

  it("computes fullOrdersPossible as floor division", () => {
    assert.equal(computeFullOrdersPossible(221, 100, "known"), 2);
    assert.equal(computeFullOrdersPossible(134, 100, "known"), 1);
    assert.equal(computeFullOrdersPossible(23, 100, "known"), 0);
    assert.equal(computeFullOrdersPossible(500, 100, "unknown"), 0);
  });

  it("derives NC 6+ / qty 100 as available and VA as strong", () => {
    const model = getInventoryExplorerFixture();
    const derived = deriveInventoryExplorer(
      model,
      {
        nicheKey: "truckers",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );
    const nc = derived.states.find((s) => s.stateCode === "NC")!;
    const va = derived.states.find((s) => s.stateCode === "VA")!;
    assert.equal(nc.filteredAvailable, 134);
    assert.equal(nc.fulfillmentStatus, "available");
    assert.equal(nc.fullOrdersPossible, 1);
    assert.equal(va.filteredAvailable, 221);
    assert.equal(va.fulfillmentStatus, "strong");
    assert.equal(va.fullOrdersPossible, 2);
  });

  it("marks NC 3–6 / qty 100 as custom_review", () => {
    const model = getInventoryExplorerFixture();
    const derived = deriveInventoryExplorer(
      model,
      {
        nicheKey: "truckers",
        selectedAgeBuckets: ["3_6"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );
    const nc = derived.states.find((s) => s.stateCode === "NC")!;
    assert.equal(nc.filteredAvailable, 23);
    assert.equal(nc.fulfillmentStatus, "custom_review");
  });

  it("keeps omitted states unknown, never unavailable", () => {
    const model = getInventoryExplorerFixture();
    const derived = deriveInventoryExplorer(
      model,
      model.defaultFilters,
      new Set()
    );
    const tx = derived.states.find((s) => s.stateCode === "TX")!;
    assert.equal(tx.dataStatus, "unknown");
    assert.equal(tx.fulfillmentStatus, "unknown");
    assert.notEqual(tx.fulfillmentStatus, "unavailable");
    assert.equal(tx.relativeVolumeBand, "unknown");
  });

  it("labels mixed-timezone states without inventing TZ counts", () => {
    const model = getInventoryExplorerFixture();
    const fl = model.states.find((s) => s.stateCode === "FL")!;
    assert.equal(fl.timezoneStatus, "mixed");
    assert.ok(fl.timezones.length >= 2);
    assert.equal(fl.dataStatus, "unknown");
  });

  it("zeros known inventory when niche has no fixture rows", () => {
    const model = getInventoryExplorerFixture();
    const derived = deriveInventoryExplorer(
      model,
      {
        nicheKey: "homeowners",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );
    const nc = derived.states.find((s) => s.stateCode === "NC")!;
    const tx = derived.states.find((s) => s.stateCode === "TX")!;
    assert.equal(nc.filteredAvailable, 0);
    assert.equal(nc.fulfillmentStatus, "unavailable");
    assert.equal(tx.fulfillmentStatus, "unknown");
  });

  it("exposes disabled write capabilities and notice copy", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    assert.equal(model.capabilities.canRequestQuote, false);
    assert.equal(model.capabilities.showRoutingPrototype, false);
    assert.equal(model.snapshot.isPartialReport, true);
    assert.match(model.snapshot.reportLabel, /PARTIAL/i);
    assert.equal(
      INVENTORY_EXPLORER_NOTICE,
      "Inventory preview using aggregate snapshot data. No inventory is reserved and no order is created from this screen."
    );
  });
});
