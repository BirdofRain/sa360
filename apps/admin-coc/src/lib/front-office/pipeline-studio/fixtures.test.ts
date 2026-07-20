import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getInventoryExplorerFixture } from "./inventory-fixtures";
import { getPipelineStudioFixture, PIPELINE_STUDIO_FIXTURE } from "./fixtures";

describe("inventory explorer fixture (primary beta)", () => {
  it("loads both authoritative 7/20 Lead Processor reports", () => {
    const model = getInventoryExplorerFixture();
    const trucker = model.niches.TRUCKER;
    const vet = model.niches.VET;

    assert.deepEqual(
      model.availableNiches.map((n) => n.key),
      ["TRUCKER", "VET"]
    );

    assert.equal(trucker.snapshot.reportVersion, "5.0.0");
    assert.equal(trucker.snapshot.sourceSheet, "Truckers");
    assert.equal(trucker.snapshot.completeness, "COMPLETE_WITH_WARNINGS");
    assert.equal(trucker.snapshot.publishedTotals.combined, 18707);
    assert.equal(trucker.snapshot.mappedTotals.combined, 18661);
    assert.equal(trucker.snapshot.unmappedTotals.combined, 46);
    assert.equal(trucker.snapshot.mappedGeographyCount, 51);
    assert.equal(trucker.snapshot.unmappedGeographyCount, 31);
    assert.equal(trucker.states.length, 51);
    assert.equal(trucker.unmappedGeographies.length, 31);
    assert.ok(!trucker.states.some((s) => s.stateCode === "AB"));

    assert.equal(vet.snapshot.sourceSheet, "Vet FEX");
    assert.equal(vet.snapshot.completeness, "COMPLETE_WITH_WARNINGS");
    assert.equal(vet.snapshot.publishedTotals.combined, 147349);
    assert.equal(vet.snapshot.mappedTotals.combined, 147094);
    assert.equal(vet.snapshot.unmappedTotals.combined, 255);
    assert.equal(vet.snapshot.mappedGeographyCount, 51);
    assert.equal(vet.snapshot.unmappedGeographyCount, 85);
    assert.equal(vet.unmappedGeographies.length, 85);

    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    assert.equal(model.defaultFilters.nicheKey, "TRUCKER");
  });
});

describe("routing prototype fixture (preserved, not primary UI)", () => {
  it("still exposes the checkpoint routing read model for local reuse", () => {
    const model = getPipelineStudioFixture();
    assert.equal(model.dataSource, "mock");
    assert.equal(model.origin.city, "Raleigh");
    assert.equal(PIPELINE_STUDIO_FIXTURE.capabilities.canPublish, false);
    assert.ok(model.routes.length >= 1);
  });
});
