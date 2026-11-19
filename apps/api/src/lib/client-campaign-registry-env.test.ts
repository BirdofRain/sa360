import assert from "node:assert/strict";
import test from "node:test";

import { isClientCampaignRegistryEnabled } from "./client-campaign-registry-env.js";

test("the client campaign registry flag is exact-true and off by default", () => {
  assert.equal(isClientCampaignRegistryEnabled({}), false);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "" }), false);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "TRUE" }), false);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "1" }), false);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "yes" }), false);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "on" }), false);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: " true " }), true);
  assert.equal(isClientCampaignRegistryEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "true" }), true);
});
