import test from "node:test";
import assert from "node:assert/strict";

import {
  collectLeadCaptureTrustPilotScopeBlockers,
  validateSourceLeadEventPilotScope,
} from "./leadcapture-trust-scope.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
  LEADCAPTURE_TRUST_PILOT_LEGACY_FORM_ID,
  LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
} from "./leadcapture-trust.constants.js";

function withFormAllowlist(funnelId: string, run: () => void) {
  const prevEnabled = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  const prevToken = process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  const prevCampaigns = process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST;
  const prevForms = process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = "test-token";
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST = LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST = funnelId;
  try {
    run();
  } finally {
    if (prevEnabled === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
    else process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = prevEnabled;
    if (prevToken === undefined) delete process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
    else process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = prevToken;
    if (prevCampaigns === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST;
    else process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST = prevCampaigns;
    if (prevForms === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
    else process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST = prevForms;
  }
}

test("correct Data API funnel UUID is accepted", () => {
  withFormAllowlist(LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID, () => {
    const blockers = collectLeadCaptureTrustPilotScopeBlockers({
      campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerCampaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerFormId: LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
    });
    assert.equal(blockers.includes("provider_form_mismatch"), false);
    assert.equal(blockers.includes("form_not_allowlisted"), false);
    assert.equal(blockers.includes("provider_campaign_mismatch"), false);
  });
});

test("legacy numeric form ID is rejected as provider funnel", () => {
  withFormAllowlist(LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID, () => {
    const blockers = collectLeadCaptureTrustPilotScopeBlockers({
      campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerFormId: LEADCAPTURE_TRUST_PILOT_LEGACY_FORM_ID,
    });
    assert.equal(blockers.includes("provider_form_mismatch"), true);
    assert.equal(blockers.includes("form_not_allowlisted"), true);
  });
});

test("wrong funnel UUID is rejected", () => {
  withFormAllowlist(LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID, () => {
    const blockers = collectLeadCaptureTrustPilotScopeBlockers({
      campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerFormId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    assert.equal(blockers.includes("provider_form_mismatch"), true);
    assert.equal(blockers.includes("form_not_allowlisted"), true);
  });
});

test("missing provider funnel is blocked", () => {
  withFormAllowlist(LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID, () => {
    const blockers = collectLeadCaptureTrustPilotScopeBlockers({
      campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerFormId: null,
    });
    assert.equal(blockers.includes("provider_form_mismatch"), true);
    assert.equal(blockers.includes("form_not_allowlisted"), true);
  });
});

test("absent provider campaign does not fabricate mismatch or match", () => {
  withFormAllowlist(LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID, () => {
    const blockers = collectLeadCaptureTrustPilotScopeBlockers({
      campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerCampaignId: null,
      providerFormId: LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
    });
    assert.equal(blockers.includes("provider_campaign_mismatch"), false);
    assert.equal(blockers.length, 0);
  });
});

test("conflicting provider campaign remains blocked", () => {
  withFormAllowlist(LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID, () => {
    const blockers = collectLeadCaptureTrustPilotScopeBlockers({
      campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      providerCampaignId: "OTHER_CAMPAIGN",
      providerFormId: LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
    });
    assert.equal(blockers.includes("provider_campaign_mismatch"), true);
  });
});

test("internal campaign key remains the SA360 pilot key", () => {
  assert.equal(LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY, "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX");
});

test("legacy source metadata may still contain form ID 23381", () => {
  assert.equal(LEADCAPTURE_TRUST_PILOT_LEGACY_FORM_ID, "23381");
  assert.notEqual(LEADCAPTURE_TRUST_PILOT_LEGACY_FORM_ID, LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID);
});

test("empty form allowlist fails closed", () => {
  const prev = process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
  const prevEnabled = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  const prevToken = process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  const prevCampaigns = process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST;
  delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = "test-token";
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST = LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY;
  const blockers = collectLeadCaptureTrustPilotScopeBlockers({
    campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
    providerFormId: LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
  });
  assert.equal(blockers.includes("form_not_allowlisted"), true);
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST = prev;
  if (prevEnabled === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = prevEnabled;
  if (prevToken === undefined) delete process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  else process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = prevToken;
  if (prevCampaigns === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST = prevCampaigns;
});

test("source lead event scope rejects wrong client and lane", () => {
  const blockers = validateSourceLeadEventPilotScope({
    campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
    sourceRouteKey: "OTHER",
    clientAccountIdResolved: "other_client",
    sourceProvider: "facebook",
  });
  assert.deepEqual(blockers.sort(), ["campaign_mismatch", "client_mismatch", "source_lane_mismatch"].sort());
  assert.equal(LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID, "vet_life_james_torrey");
});
