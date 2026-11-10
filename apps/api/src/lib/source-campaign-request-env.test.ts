import assert from "node:assert/strict";
import test from "node:test";

import { isSourceCampaignRequestEnabled } from "./source-campaign-request-env.js";

test("the source campaign request flag is exact-true and off by default", () => {
  assert.equal(isSourceCampaignRequestEnabled({}), false);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "" }), false);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "TRUE" }), false);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "1" }), false);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "yes" }), false);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "on" }), false);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: " true " }), true);
  assert.equal(isSourceCampaignRequestEnabled({ SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED: "true" }), true);
});
