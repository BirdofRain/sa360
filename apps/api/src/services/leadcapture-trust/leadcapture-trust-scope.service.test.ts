import test from "node:test";
import assert from "node:assert/strict";

import {
  collectLeadCaptureTrustPilotScopeBlockers,
  validateSourceLeadEventPilotScope,
} from "./leadcapture-trust-scope.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
  LEADCAPTURE_TRUST_PILOT_FORM_ID,
} from "./leadcapture-trust.constants.js";

test("scope blockers include provider campaign and form mismatch", () => {
  const blockers = collectLeadCaptureTrustPilotScopeBlockers({
    campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
    providerCampaignId: "OTHER_CAMPAIGN",
    providerFormId: "99999",
  });
  assert.equal(blockers.includes("provider_campaign_mismatch"), true);
  assert.equal(blockers.includes("provider_form_mismatch"), true);
});

test("empty form allowlist fails closed", () => {
  const prev = process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
  delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
  const blockers = collectLeadCaptureTrustPilotScopeBlockers({
    campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
    providerFormId: LEADCAPTURE_TRUST_PILOT_FORM_ID,
  });
  assert.equal(blockers.includes("form_not_allowlisted"), true);
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST = prev;
});

test("source lead event scope rejects wrong client and lane", () => {
  const blockers = validateSourceLeadEventPilotScope({
    campaignId: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
    sourceRouteKey: "OTHER",
    clientAccountIdResolved: "other_client",
    sourceProvider: "facebook",
  });
  assert.deepEqual(blockers.sort(), ["campaign_mismatch", "client_mismatch", "source_lane_mismatch"].sort());
});
