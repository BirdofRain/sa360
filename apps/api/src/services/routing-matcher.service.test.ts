import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignRoutingRule } from "@prisma/client";
import type { RoutingAttributionInput } from "../lib/routing-attribution-extract.js";
import { matchCampaignRoutingRule } from "./routing-matcher.service.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function rule(
  partial: Partial<CampaignRoutingRule> & Pick<CampaignRoutingRule, "id" | "matchType" | "clientAccountId">
): CampaignRoutingRule {
  return {
    masterClientAccountId: "master_1",
    destinationSubaccountIdGhl: partial.destinationSubaccountIdGhl ?? "loc_dest",
    clientDisplayName: partial.clientDisplayName ?? "Agent",
    nicheKey: null,
    productType: null,
    sourcePlatform: null,
    sourceType: null,
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: null,
    utmContent: null,
    masterDatasetId: null,
    keywordPattern: null,
    priority: 100,
    active: true,
    effectiveStart: null,
    effectiveEnd: null,
    destinationWorkflowIdGhl: null,
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    backupSheetEnabled: false,
    backupSheetId: null,
    defaultAssignedUserIdGhl: null,
    deliveryEnabled: false,
    shadowDeliveryEnabled: true,
    locationName: null,
    ghlConnectionStatus: null,
    snapshotInstalled: false,
    requiredFieldsInstalled: false,
    deliveryMode: "shadow",
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    lastReadinessCheckAt: null,
    readinessStatus: "not_ready",
    readinessWarnings: null,
    sourceAttributeFieldMapJson: {},
    sourceFieldAliasOverridesJson: {},
    opportunityCreationEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

const baseInput: RoutingAttributionInput = {
  masterClientAccountId: "master_1",
  campaignId: "camp_100",
  adsetId: "adset_200",
  adId: "ad_300",
  utmCampaign: "vet-funnel-a",
  formId: "form_9",
};

test("exact campaign_id match wins over lower-priority adset rule", () => {
  const rules = [
    rule({
      id: "r_adset",
      matchType: "adset_id",
      clientAccountId: "client_b",
      adsetId: "adset_200",
      priority: 500,
    }),
    rule({
      id: "r_campaign",
      matchType: "campaign_id",
      clientAccountId: "client_a",
      campaignId: "camp_100",
      priority: 100,
    }),
  ];
  const result = matchCampaignRoutingRule(rules, baseInput, NOW);
  assert.equal(result.matched, true);
  assert.equal(result.matchedRuleId, "r_campaign");
  assert.equal(result.destinationClientAccountId, "client_a");
  assert.equal(result.confidence, "high");
});

test("adset_id fallback when campaign_id does not match", () => {
  const rules = [
    rule({
      id: "r_campaign_miss",
      matchType: "campaign_id",
      clientAccountId: "client_x",
      campaignId: "other",
      priority: 200,
    }),
    rule({
      id: "r_adset",
      matchType: "adset_id",
      clientAccountId: "client_b",
      adsetId: "adset_200",
      priority: 50,
    }),
  ];
  const result = matchCampaignRoutingRule(
    rules,
    { ...baseInput, campaignId: "unknown" },
    NOW
  );
  assert.equal(result.matchedRuleId, "r_adset");
});

test("ad_id tier matches when campaign and adset miss", () => {
  const rules = [
    rule({
      id: "r_ad",
      matchType: "ad_id",
      clientAccountId: "client_c",
      adId: "ad_300",
      priority: 10,
    }),
  ];
  const result = matchCampaignRoutingRule(
    rules,
    { ...baseInput, campaignId: undefined, adsetId: undefined },
    NOW
  );
  assert.equal(result.matchedRuleId, "r_ad");
});

test("utm_campaign fallback works", () => {
  const rules = [
    rule({
      id: "r_utm",
      matchType: "utm_campaign",
      clientAccountId: "client_utm",
      utmCampaign: "vet-funnel-a",
      priority: 80,
    }),
  ];
  const result = matchCampaignRoutingRule(
    rules,
    {
      masterClientAccountId: "master_1",
      utmCampaign: "vet-funnel-a",
    },
    NOW
  );
  assert.equal(result.matched, true);
  assert.equal(result.confidence, "medium");
});

test("inactive rules are ignored", () => {
  const rules = [
    rule({
      id: "r_off",
      matchType: "campaign_id",
      clientAccountId: "client_a",
      campaignId: "camp_100",
      active: false,
    }),
  ];
  const result = matchCampaignRoutingRule(rules, baseInput, NOW);
  assert.equal(result.matched, false);
  assert.equal(result.confidence, "none");
  assert.ok(result.reason.includes("review"));
});

test("unmatched lead returns review_required reason", () => {
  const result = matchCampaignRoutingRule([], baseInput, NOW);
  assert.equal(result.matched, false);
  assert.ok(result.reason.toLowerCase().includes("review"));
});

test("campaign_id matches when rule has scope dimensions absent on lead payload", () => {
  const rules = [
    rule({
      id: "r_scoped",
      matchType: "campaign_id",
      clientAccountId: "client_dest",
      campaignId: "120243339037000760",
      nicheKey: "VET",
      productType: "Final Expense",
      sourcePlatform: "facebook",
      sourceType: "facebook_lead_form",
      masterDatasetId: "943556280266263",
      priority: 100,
    }),
  ];
  const result = matchCampaignRoutingRule(
    rules,
    {
      masterClientAccountId: "lal_master_vet",
      campaignId: "120243339037000760",
      sourcePlatform: "facebook",
      sourceType: "facebook_lead_form",
    },
    NOW
  );
  assert.equal(result.matched, true);
  assert.equal(result.matchedRuleId, "r_scoped");
});

test("scope rejects when lead provides conflicting nicheKey", () => {
  const rules = [
    rule({
      id: "r_scoped",
      matchType: "campaign_id",
      clientAccountId: "client_dest",
      campaignId: "camp_100",
      nicheKey: "VET",
      priority: 100,
    }),
  ];
  const result = matchCampaignRoutingRule(
    rules,
    {
      ...baseInput,
      nicheKey: "DENTAL",
    },
    NOW
  );
  assert.equal(result.matched, false);
});

test("keyword_fallback matches haystack", () => {
  const rules = [
    rule({
      id: "r_kw",
      matchType: "keyword_fallback",
      clientAccountId: "client_kw",
      keywordPattern: "agent-c",
      priority: 10,
    }),
  ];
  const result = matchCampaignRoutingRule(
    rules,
    {
      masterClientAccountId: "master_1",
      utmCampaign: "summer-agent-c-vet",
    },
    NOW
  );
  assert.equal(result.matchedRuleId, "r_kw");
});
