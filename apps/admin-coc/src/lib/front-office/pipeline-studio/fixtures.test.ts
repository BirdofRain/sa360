import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getInventoryExplorerFixture } from "./inventory-fixtures";
import { getPipelineStudioFixture, PIPELINE_STUDIO_FIXTURE } from "./fixtures";

describe("inventory explorer fixture (primary beta)", () => {
  it("loads Truckers partial report metadata with exact NC/VA counts", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.snapshot.reportVersion, "5.0.0");
    assert.equal(model.snapshot.sourceSheet, "Truckers");
    assert.equal(model.snapshot.sourceRowsAvailable, 28495);
    assert.equal(model.snapshot.rowsScanned, 28495);
    assert.equal(model.snapshot.isPartialReport, true);

    const nc = model.states.find((s) => s.stateCode === "NC")!;
    const va = model.states.find((s) => s.stateCode === "VA")!;
    assert.deepEqual(nc.countsByAgeBucket, {
      "1_3": 16,
      "3_6": 23,
      "6_plus": 134,
    });
    assert.deepEqual(va.countsByAgeBucket, {
      "1_3": 7,
      "3_6": 20,
      "6_plus": 221,
    });
    assert.equal(nc.dataStatus, "known");
    assert.equal(va.dataStatus, "known");

    const unknownCount = model.states.filter((s) => s.dataStatus === "unknown").length;
    assert.ok(unknownCount >= 45);
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
