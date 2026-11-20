import assert from "node:assert/strict";
import test from "node:test";

import { isClientCampaignGhlExecutionEnabled } from "./client-campaign-ghl-execution-env.js";
import { planCampaignGhlDelivery } from "../services/client-campaign-ghl-delivery/plan-campaign-ghl-delivery.js";

test("campaign GHL execution enables only for the exact string true", () => {
  assert.equal(isClientCampaignGhlExecutionEnabled({}), false);
  assert.equal(isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "" }), false);
  assert.equal(isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "TRUE" }), false);
  assert.equal(isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "1" }), false);
  assert.equal(isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "yes" }), false);
  assert.equal(isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "on" }), false);
  assert.equal(
    isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: " true " }),
    true
  );
  assert.equal(isClientCampaignGhlExecutionEnabled({ SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "true" }), true);
});

test("a disabled campaign GHL gate returns before facts are loaded", () => {
  let loaded = false;
  const plan = planCampaignGhlDelivery({
    env: {},
    facts: { campaignLaneOptIn: false },
    loadFacts: () => {
      loaded = true;
      throw new Error("facts loaded");
    },
  });
  assert.equal(loaded, false);
  assert.equal(plan.disposition, "legacy_unchanged");
  assert.deepEqual(plan.reasonCodes, ["campaign_ghl_execution_gate_off"]);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.tags.proposal, null);
  assert.equal(plan.externalCallCount, 0);
  assert.equal(plan.liveExternalCallAuthorized, false);
});
