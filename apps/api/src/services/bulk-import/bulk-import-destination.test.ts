import assert from "node:assert/strict";
import test from "node:test";
import { flatDestinationBodyToOptions } from "./bulk-import-destination.js";

test("flatDestinationBodyToOptions defaults workflowStrategy to source_tag_only", () => {
  const options = flatDestinationBodyToOptions({
    destinationClientAccountId: "vet_life_james_torrey",
    destinationLocationIdGhl: "loc_1",
    campaignLabel: "GOAT",
  });
  assert.equal(options.workflowStrategy, "source_tag_only");
  assert.equal(options.workflowWarningAcknowledged, true);
  assert.equal(options.campaignLabel, "GOAT");
});
