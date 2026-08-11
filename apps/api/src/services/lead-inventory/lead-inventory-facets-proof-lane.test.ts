import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FACETS_PROOF_REQUIRED_LANES,
  FACETS_SOURCE_LANE_PARITY_FIXTURES,
  isFacetsProofRequiredLane,
  normalizeFacetsProofLaneFromEvent,
  normalizeFacetsProofLaneFromInventorySourceLane,
} from "./lead-inventory-facets-proof-lane.js";

test("inventory-derived and event-derived proof_lane match for all parity fixtures", () => {
  for (const fixture of FACETS_SOURCE_LANE_PARITY_FIXTURES) {
    const fromInventory = normalizeFacetsProofLaneFromInventorySourceLane(
      fixture.inventorySourceLane
    );
    const fromEvent = normalizeFacetsProofLaneFromEvent({
      enrichmentSourceLane: fixture.eventEnrichmentSourceLane,
      sourceProvider: fixture.eventSourceProvider,
      sourceSystem: fixture.eventSourceSystem,
    });
    assert.equal(
      fromInventory,
      fromEvent,
      `parity failed for ${fixture.name}: inventory=${fromInventory} event=${fromEvent}`
    );
  }
});

test("authorized aliases normalize exactly", () => {
  assert.equal(
    normalizeFacetsProofLaneFromInventorySourceLane("facebook_meta_lead_ads"),
    "meta_lead_ads"
  );
  assert.equal(
    normalizeFacetsProofLaneFromInventorySourceLane("google_sheets_google_sheet_import"),
    "google_sheet_import"
  );
  assert.equal(
    normalizeFacetsProofLaneFromInventorySourceLane("  FACEBOOK_META_LEAD_ADS  "),
    "meta_lead_ads"
  );
});

test("unknown and empty inventory lanes are not remapped", () => {
  assert.equal(
    normalizeFacetsProofLaneFromInventorySourceLane("totally_unknown_lane"),
    "totally_unknown_lane"
  );
  // Authorized inventory SQL: LOWER(TRIM(sourceLane)) with no provider/system fallback.
  assert.equal(normalizeFacetsProofLaneFromInventorySourceLane(""), "");
  assert.equal(normalizeFacetsProofLaneFromInventorySourceLane("   "), "");
  assert.equal(normalizeFacetsProofLaneFromInventorySourceLane(null), "");
  assert.equal(normalizeFacetsProofLaneFromInventorySourceLane(undefined), "");
});

test("proof-required membership remains identical across event vs inventory lanes", () => {
  for (const fixture of FACETS_SOURCE_LANE_PARITY_FIXTURES) {
    const fromInventory = normalizeFacetsProofLaneFromInventorySourceLane(
      fixture.inventorySourceLane
    );
    const fromEvent = normalizeFacetsProofLaneFromEvent({
      enrichmentSourceLane: fixture.eventEnrichmentSourceLane,
      sourceProvider: fixture.eventSourceProvider,
      sourceSystem: fixture.eventSourceSystem,
    });
    assert.equal(
      isFacetsProofRequiredLane(fromInventory),
      isFacetsProofRequiredLane(fromEvent),
      `proof-required membership diverged for ${fixture.name}`
    );
  }

  assert.equal(isFacetsProofRequiredLane("leadcapture_io"), true);
  assert.equal(isFacetsProofRequiredLane("leadconduit_facebook"), true);
  assert.equal(isFacetsProofRequiredLane("meta_lead_ads"), false);
  assert.equal(isFacetsProofRequiredLane("facebook_meta_lead_ads"), false);
  assert.equal(isFacetsProofRequiredLane("google_sheet_import"), false);
  assert.deepEqual([...FACETS_PROOF_REQUIRED_LANES], [
    "leadcapture_io",
    "leadconduit_facebook",
  ]);
});
