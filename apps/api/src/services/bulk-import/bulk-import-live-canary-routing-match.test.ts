import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignRoutingRule } from "@prisma/client";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import {
  resolveRoutingRuleMatchValue,
} from "./bulk-import-live-canary-routing-match.service.js";

const LONG_CAMPAIGN_ID = "120235026513880436";

function demoRule(
  partial: Partial<CampaignRoutingRule> & Pick<CampaignRoutingRule, "id">
): CampaignRoutingRule {
  return {
    id: partial.id,
    masterClientAccountId: "lal_master_vet",
    clientAccountId: "smart_agent_360_demo_2",
    clientDisplayName: "SA360 Demo",
    destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    matchType: "campaign_id",
    campaignId: LONG_CAMPAIGN_ID,
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: null,
    keywordPattern: null,
    nicheKey: "VET",
    productType: "Final Expense",
    sourcePlatform: "facebook",
    sourceType: null,
    masterDatasetId: null,
    priority: 100,
    active: true,
    effectiveStart: null,
    effectiveEnd: null,
    deliveryEnabled: true,
    shadowDeliveryEnabled: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  } as CampaignRoutingRule;
}

test("resolveRoutingRuleMatchValue exposes campaign_id for operators", () => {
  const resolved = resolveRoutingRuleMatchValue(demoRule({ id: "rule_1" }));
  assert.equal(resolved.matchField, "campaign_id");
  assert.equal(resolved.matchValue, LONG_CAMPAIGN_ID);
});

test("unmatched campaign_id fails routing match before live delivery", () => {
  const rules = [demoRule({ id: "rule_demo" })];
  const result = matchCampaignRoutingRule(rules, {
    masterClientAccountId: "lal_master_vet",
    campaignId: "wrong_campaign",
    nicheKey: "VET",
    productType: "Final Expense",
    sourcePlatform: "facebook",
  });
  assert.equal(result.matched, false);
  assert.match(result.reason, /No active routing rule matched attribution/);
});

test("matched campaign_id satisfies routing match gate under lal_master_vet", () => {
  const rules = [demoRule({ id: "rule_demo" })];
  const result = matchCampaignRoutingRule(rules, {
    masterClientAccountId: "lal_master_vet",
    campaignId: LONG_CAMPAIGN_ID,
    nicheKey: "VET",
    productType: "Final Expense",
    sourcePlatform: "facebook",
  });
  assert.equal(result.matched, true);
  assert.equal(result.matchedRuleId, "rule_demo");
});
