import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignRoutingRule } from "@prisma/client";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import {
  resolveRoutingRuleMatchValue,
} from "./bulk-import-live-canary-routing-match.service.js";
import { formatBulkImportRoutingFailureLines } from "./bulk-import-routing-delivery-diagnostics.service.js";

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

test("CSV campaign_id exact string match routes under lal_master_vet rules", () => {
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

test("long numeric campaign IDs stay strings through attribution extract", () => {
  const input = extractRoutingAttributionFromPayload({
    schema_version: "MASTER 2.0",
    client_account_id: "lal_master_vet",
    subaccount_id_ghl: "VPuMIhN6JpxdoXvvlekZ",
    contact: { lead_uid: "lead-1" },
    attribution: {
      source_platform: "facebook",
      source_type: "bulk_import",
      campaign_id: LONG_CAMPAIGN_ID,
    },
    state: { lifecycle_stage: "NEW", routing_status: "RECEIVED", lead_type: "VET" },
    event: {
      event_uuid: "evt-1",
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    routing: { niche_key: "VET", product_type: "Final Expense" },
    policy: { product_type: "Final Expense" },
  } as never);
  assert.equal(input.campaignId, LONG_CAMPAIGN_ID);
  assert.equal(typeof input.campaignId, "string");
});

test("numeric JSON campaign_id loses precision — CSV must keep campaign_id as string", () => {
  const input = extractRoutingAttributionFromPayload({
    schema_version: "MASTER 2.0",
    client_account_id: "lal_master_vet",
    subaccount_id_ghl: "loc",
    contact: { lead_uid: "lead-1" },
    attribution: {
      source_platform: "facebook",
      source_type: "bulk_import",
      campaign_id: 120235026513880436,
    },
    state: { lifecycle_stage: "NEW", routing_status: "RECEIVED" },
    event: {
      event_uuid: "evt-1",
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
  } as never);
  assert.notEqual(input.campaignId, LONG_CAMPAIGN_ID);
  assert.equal(input.campaignId, "120235026513880430");
});

test("lookup under wrong master returns zero rules so delivery cannot match", () => {
  const rulesForWrongMaster: CampaignRoutingRule[] = [];
  const result = matchCampaignRoutingRule(rulesForWrongMaster, {
    masterClientAccountId: "smart_agent_360_demo_2",
    campaignId: LONG_CAMPAIGN_ID,
  });
  assert.equal(result.matched, false);
  assert.match(result.reason, /No active routing rule matched attribution/);
});

test("missing campaign_id produces manual review blocker copy", () => {
  const rules = [demoRule({ id: "rule_demo" })];
  const result = matchCampaignRoutingRule(rules, {
    masterClientAccountId: "lal_master_vet",
    nicheKey: "VET",
    productType: "Final Expense",
  });
  assert.equal(result.matched, false);
  assert.match(result.reason, /No active routing rule matched attribution/);
});

test("routing failure diagnostics explain master client and campaign_id tried", () => {
  const lines = formatBulkImportRoutingFailureLines({
    batchId: "batch_1",
    sourceLeadEventId: "evt_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    routingMasterClientAccountId: "smart_agent_360_demo_2",
    triedCampaignId: LONG_CAMPAIGN_ID,
    triedCampaignName: null,
    triedUtmCampaign: null,
    triedSourcePlatform: "manual_import",
    triedSourceType: "bulk_import",
    triedNicheKey: "VET",
    triedProductType: "Final Expense",
    normalizedAttribution: {
      masterClientAccountId: "smart_agent_360_demo_2",
      campaignId: LONG_CAMPAIGN_ID,
    },
    preservedSourceAttributes: { campaign_id: LONG_CAMPAIGN_ID },
    rulesConsidered: [
      {
        id: "rule_demo",
        masterClientAccountId: "lal_master_vet",
        destinationClientAccountId: "smart_agent_360_demo_2",
        destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
        matchType: "campaign_id",
        matchField: "campaign_id",
        matchValue: LONG_CAMPAIGN_ID,
        nicheKey: "VET",
        productType: "Final Expense",
        sourcePlatform: "facebook",
        active: true,
        deliveryEnabled: true,
      },
    ],
    rulesConsideredCount: 1,
    closestRuleMismatch: "Rule rule_demo (campaign_id): tier_key_mismatch",
    matched: false,
    matchedRuleId: null,
    reason: "No active routing rule matched attribution; manual review required.",
  });
  assert.ok(lines.some((line) => line.includes(`Tried campaign_id: ${LONG_CAMPAIGN_ID}`)));
  assert.ok(lines.some((line) => line.includes("Looked under masterClientAccountId: smart_agent_360_demo_2")));
  assert.ok(lines.some((line) => line.includes("Rules considered: 1")));
});

test("resolveRoutingRuleMatchValue keeps campaign_id as string from rule record", () => {
  const resolved = resolveRoutingRuleMatchValue(demoRule({ id: "rule_demo" }));
  assert.equal(resolved.matchField, "campaign_id");
  assert.equal(resolved.matchValue, LONG_CAMPAIGN_ID);
});
