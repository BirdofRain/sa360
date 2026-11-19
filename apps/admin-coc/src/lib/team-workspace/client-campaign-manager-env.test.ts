import assert from "node:assert/strict";
import test from "node:test";

import {
  clientCampaignManagerBlock,
  isClientCampaignManagerEnabled,
  isClientCampaignRegistryServerEnabled,
} from "./client-campaign-manager-env.ts";

test("the campaign manager stays off unless its own flag is exactly true", () => {
  assert.equal(isClientCampaignManagerEnabled({}), false);
  assert.equal(isClientCampaignManagerEnabled({ NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED: " TRUE " }), false);
  assert.equal(isClientCampaignManagerEnabled({ NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED: "1" }), false);
  assert.equal(isClientCampaignManagerEnabled({ NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED: " true " }), true);
});

test("the interface flag does not enable the registry", () => {
  const env = {
    NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED: "true",
    NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED: "true",
    SA360_TEAM_WORKSPACE_ENABLED: "true",
  };
  assert.equal(isClientCampaignRegistryServerEnabled(env), false);
  assert.equal(clientCampaignManagerBlock(env), "registry");
  assert.equal(isClientCampaignRegistryServerEnabled({ SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "TRUE" }), false);
  assert.equal(clientCampaignManagerBlock({ ...env, SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED: "true" }), null);
});
