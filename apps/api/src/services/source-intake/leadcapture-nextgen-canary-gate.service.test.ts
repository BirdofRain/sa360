import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNextGenLiveCanaryAllowed,
  isLegacyLeadCaptureCampaignPausedForNextGen,
} from "./leadcapture-nextgen-canary-gate.service.js";

test("legacy pause campaign list", () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS;
  process.env.SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS =
    "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX,OTHER";
  assert.equal(
    isLegacyLeadCaptureCampaignPausedForNextGen("LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"),
    true
  );
  assert.equal(isLegacyLeadCaptureCampaignPausedForNextGen("NOT_PAUSED"), false);
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS;
});

test("live canary gate disabled by default", async () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED;
  delete process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED;
  const result = await assertNextGenLiveCanaryAllowed({
    sourceLeadEventId: "evt_1",
    clientAccountId: "client_a",
    campaignId: "camp_a",
    deliveryMode: "live_canary",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "live_canary_disabled");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED = prev;
});

test("live canary gate requires matching client/campaign/mode", async () => {
  const prevEnabled = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED;
  const prevClient = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CLIENT_ACCOUNT_ID;
  const prevCampaign = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CAMPAIGN_ID;
  process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CLIENT_ACCOUNT_ID = "client_a";
  process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CAMPAIGN_ID = "camp_a";

  const wrongClient = await assertNextGenLiveCanaryAllowed({
    sourceLeadEventId: "evt_1",
    clientAccountId: "other",
    campaignId: "camp_a",
    deliveryMode: "live_canary",
  });
  assert.equal(wrongClient.ok, false);
  if (!wrongClient.ok) assert.equal(wrongClient.reason, "client_not_allowlisted");

  const wrongMode = await assertNextGenLiveCanaryAllowed({
    sourceLeadEventId: "evt_1",
    clientAccountId: "client_a",
    campaignId: "camp_a",
    deliveryMode: "shadow",
  });
  assert.equal(wrongMode.ok, false);
  if (!wrongMode.ok) assert.equal(wrongMode.reason, "delivery_mode_not_live_canary");

  if (prevEnabled !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED = prevEnabled;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED;
  if (prevClient !== undefined) {
    process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CLIENT_ACCOUNT_ID = prevClient;
  } else delete process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CLIENT_ACCOUNT_ID;
  if (prevCampaign !== undefined) {
    process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CAMPAIGN_ID = prevCampaign;
  } else delete process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CAMPAIGN_ID;
});
