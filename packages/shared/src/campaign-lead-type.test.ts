import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_LEAD_TYPE_LABELS,
  campaignLeadTypeKeyFromLabel,
  campaignLeadTypeLabel,
  isCampaignLeadTypeKey,
} from "./campaign-lead-type.ts";

test("controlled campaign lead types use the exact delivery labels", () => {
  assert.equal(campaignLeadTypeLabel("vet_web_form"), "Vet Web Form");
  assert.equal(campaignLeadTypeLabel("nurse_web_form"), "Nurse Web Form");
  assert.equal(campaignLeadTypeLabel("trucker_web_form"), "Trucker Web Form");
  assert.equal(CAMPAIGN_LEAD_TYPE_LABELS.vet_web_form, "Vet Web Form");
});

test("only an exact key or exact label is a campaign lead type", () => {
  assert.equal(isCampaignLeadTypeKey("vet_web_form"), true);
  assert.equal(isCampaignLeadTypeKey("VET"), false);
  assert.equal(isCampaignLeadTypeKey("Vet Web Form"), false);
  assert.equal(campaignLeadTypeKeyFromLabel("Vet Web Form"), "vet_web_form");
  assert.equal(campaignLeadTypeKeyFromLabel("vet web form"), null);
  assert.equal(campaignLeadTypeKeyFromLabel("Veteran"), null);
});
