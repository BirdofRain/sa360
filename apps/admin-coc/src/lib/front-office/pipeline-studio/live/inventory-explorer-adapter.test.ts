import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getInventoryExplorerFixture } from "../inventory-fixtures";

describe("inventory explorer BFF fallback contract", () => {
  it("fixture path exposes provenance and disabled write capabilities", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.provenance.source, "fixture_csv");
    assert.equal(model.provenance.freshness, "fallback");
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    assert.equal(model.capabilities.canRequestQuote, false);
    assert.equal(model.niches.TRUCKER.snapshot.publishedTotals.combined, 18707);
    assert.equal(model.niches.TRUCKER.snapshot.mappedTotals.combined, 18661);
    assert.equal(model.niches.TRUCKER.snapshot.unmappedTotals.combined, 46);
    assert.equal(model.niches.VET.snapshot.publishedTotals.combined, 147349);
    assert.equal(model.niches.VET.snapshot.mappedTotals.combined, 147094);
    assert.equal(model.niches.VET.snapshot.unmappedTotals.combined, 255);
  });
});
