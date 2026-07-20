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
import { INVENTORY_EXPLORER_SAFETY_LINE } from "./inventory-types";

describe("inventory explorer compute", () => {
  it("clamps requested quantity to a positive demo range", () => {
    assert.equal(clampRequestedQuantity(0), 1);
    assert.equal(clampRequestedQuantity(99999), 5000);
  });

  it("sums selected age buckets for known states", () => {
    const counts = { "1_3": 32, "3_6": 27, "6_plus": 181 };
    assert.equal(filteredAvailableForState(counts, ["6_plus"], "known"), 181);
    assert.equal(filteredAvailableForState(counts, ["6_plus"], "unknown"), 0);
  });

  it("applies fulfillment thresholds including quantity changes", () => {
    assert.equal(computeFulfillmentStatus(181, 100, "known"), "available");
    assert.equal(computeFulfillmentStatus(378, 100, "known"), "strong");
    assert.equal(computeFulfillmentStatus(20, 100, "known"), "custom_review");
    assert.equal(computeFulfillmentStatus(0, 100, "unknown"), "unknown");
  });

  it("computes fullOrdersPossible as floor division", () => {
    assert.equal(computeFullOrdersPossible(431, 100, "known"), 4);
    assert.equal(computeFullOrdersPossible(181, 100, "known"), 1);
  });

  it("switches niches without merging inventories", () => {
    const model = getInventoryExplorerFixture();
    const trucker = deriveInventoryExplorer(
      model,
      {
        nicheKey: "TRUCKER",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );
    const vet = deriveInventoryExplorer(
      model,
      {
        nicheKey: "VET",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );

    assert.equal(trucker.activeNiche.nicheKey, "TRUCKER");
    assert.equal(vet.activeNiche.nicheKey, "VET");
    assert.equal(trucker.activeNiche.snapshot.publishedTotals.combined, 18707);
    assert.equal(vet.activeNiche.snapshot.publishedTotals.combined, 147349);
    assert.notEqual(trucker.kpis.totalMatching, vet.kpis.totalMatching);

    const truckerNc = trucker.states.find((s) => s.stateCode === "NC")!;
    const vetNc = vet.states.find((s) => s.stateCode === "NC")!;
    assert.equal(truckerNc.filteredAvailable, 181);
    assert.equal(vetNc.filteredAvailable, 3762);
  });

  it("preserves age filtering after niche switching", () => {
    const model = getInventoryExplorerFixture();
    const trucker13 = deriveInventoryExplorer(
      model,
      {
        nicheKey: "TRUCKER",
        selectedAgeBuckets: ["1_3"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );
    const vet13 = deriveInventoryExplorer(
      model,
      {
        nicheKey: "VET",
        selectedAgeBuckets: ["1_3"],
        selectedTimezone: null,
        requestedQuantity: 100,
      },
      new Set()
    );
    assert.equal(
      trucker13.states.find((s) => s.stateCode === "TX")!.filteredAvailable,
      40
    );
    assert.equal(
      vet13.states.find((s) => s.stateCode === "TX")!.filteredAvailable,
      2328
    );
  });

  it("quantity changes fulfillment independently per niche", () => {
    const model = getInventoryExplorerFixture();
    const truckerLowQty = deriveInventoryExplorer(
      model,
      {
        nicheKey: "TRUCKER",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 50,
      },
      new Set()
    );
    const truckerHighQty = deriveInventoryExplorer(
      model,
      {
        nicheKey: "TRUCKER",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 5000,
      },
      new Set()
    );
    const vetHighQty = deriveInventoryExplorer(
      model,
      {
        nicheKey: "VET",
        selectedAgeBuckets: ["6_plus"],
        selectedTimezone: null,
        requestedQuantity: 5000,
      },
      new Set()
    );

    const truckerNcLow = truckerLowQty.states.find((s) => s.stateCode === "NC")!;
    const truckerNcHigh = truckerHighQty.states.find((s) => s.stateCode === "NC")!;
    const vetNcHigh = vetHighQty.states.find((s) => s.stateCode === "NC")!;

    assert.equal(truckerNcLow.fulfillmentStatus, "strong");
    assert.equal(truckerNcHigh.fulfillmentStatus, "custom_review");
    assert.equal(vetNcHigh.fulfillmentStatus, "partial");
    assert.notEqual(truckerNcHigh.fulfillmentStatus, vetNcHigh.fulfillmentStatus);
  });

  it("never treats unmapped geography codes as map states", () => {
    const model = getInventoryExplorerFixture();
    const derived = deriveInventoryExplorer(
      model,
      model.defaultFilters,
      new Set()
    );
    assert.ok(!derived.states.some((s) => s.stateCode === "AB"));
    assert.ok(!derived.states.some((s) => s.stateCode === "ZZ"));
    assert.ok(
      model.niches.TRUCKER.unmappedGeographies.some((g) => g.code === "AB")
    );
    assert.equal(derived.states.length, 51);
    assert.equal(derived.kpis.unmappedInventoryTotal, 46);
  });

  it("exposes disabled write capabilities and notice copy", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    assert.equal(model.capabilities.canRequestQuote, false);
    assert.equal(
      INVENTORY_EXPLORER_SAFETY_LINE,
      "No inventory is reserved and no order is created from this screen."
    );
  });
});
