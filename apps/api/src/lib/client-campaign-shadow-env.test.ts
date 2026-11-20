import assert from "node:assert/strict";
import test from "node:test";

import { isClientCampaignShadowResolutionEnabled } from "./client-campaign-shadow-env.js";

test("shadow resolution enables only for the exact string true", () => {
  assert.equal(isClientCampaignShadowResolutionEnabled({}), false);
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "TRUE" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "1" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "yes" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "on" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({
      SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: " true ",
    }),
    true
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "true" }),
    true
  );
});
