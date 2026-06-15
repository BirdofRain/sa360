import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignRoutingRule } from "@prisma/client";
import { SA360_CORE_REQUIRED_FIELD_KEYS } from "../lib/sa360-custom-field-keys.js";
import {
  presentRoutingRuleWithReadiness,
  ruleToReadinessInput,
} from "./delivery-readiness-admin.present.js";
import { evaluateDeliveryReadiness } from "./delivery-readiness.service.js";
import { GHL_CONNECTION_CONNECTED } from "../lib/delivery-readiness-status.js";

function baseRule(overrides: Partial<CampaignRoutingRule> = {}): CampaignRoutingRule {
  return {
    id: "rule_demo",
    masterClientAccountId: "master_1",
    clientAccountId: "smart_agent_360_demo",
    destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    clientDisplayName: "Smart Agent 360 Demo",
    locationName: "Demo",
    nicheKey: null,
    productType: null,
    campaignId: "demo_campaign",
    campaignName: null,
    utmCampaign: null,
    matchType: "campaign_id",
    active: true,
    priority: 10,
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    readinessStatus: "needs_config",
    lastReadinessCheckAt: null,
    ghlConnectionStatus: GHL_CONNECTION_CONNECTED,
    snapshotInstalled: true,
    requiredFieldsInstalled: true,
    destinationWorkflowIdGhl: "wf_1",
    destinationPipelineIdGhl: "pipe_1",
    destinationPipelineStageIdGhl: "stage_1",
    backupSheetEnabled: false,
    backupSheetId: null,
    defaultAssignedUserIdGhl: "user_1",
    sourceAttributeFieldMapJson: {},
    sourceFieldAliasOverridesJson: {},
    opportunityCreationEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CampaignRoutingRule;
}

function fullCoreMap(): Record<string, string> {
  return Object.fromEntries(
    SA360_CORE_REQUIRED_FIELD_KEYS.map((key, index) => [key, `ghl_field_${index}`])
  );
}

test("presentRoutingRuleWithReadiness uses destination mapping for field readiness", () => {
  const rule = baseRule();
  const destination = {
    sa360CustomFieldIdMapJson: fullCoreMap(),
    customFieldStampRequired: false,
  };
  const item = presentRoutingRuleWithReadiness(rule, destination);
  assert.equal(item.readiness.fieldMapping.source, "destination_config");
  assert.equal(
    item.readiness.fieldMapping.coreRequiredMapped.length,
    SA360_CORE_REQUIRED_FIELD_KEYS.length
  );
  assert.equal(item.readiness.fieldMapping.coreRequiredMissing.length, 0);
});

test("presentRoutingRuleWithReadiness without destination shows none source", () => {
  const rule = baseRule();
  const item = presentRoutingRuleWithReadiness(rule, null);
  assert.equal(item.readiness.fieldMapping.source, "none");
  assert.equal(item.readiness.fieldMapping.coreRequiredMapped.length, 0);
  assert.equal(
    item.readiness.fieldMapping.coreRequiredMissing.length,
    SA360_CORE_REQUIRED_FIELD_KEYS.length
  );
});

test("ruleToReadinessInput shares destination mapping across rules for same client", () => {
  const map = fullCoreMap();
  const destination = {
    sa360CustomFieldIdMapJson: map,
    customFieldStampRequired: true,
  };
  const campaignRule = evaluateDeliveryReadiness(
    ruleToReadinessInput(baseRule({ id: "rule_campaign", matchType: "campaign_id" }), destination)
  );
  const utmRule = evaluateDeliveryReadiness(
    ruleToReadinessInput(
      baseRule({ id: "rule_utm", matchType: "utm_campaign", utmCampaign: "demo_utm", campaignId: null }),
      destination
    )
  );
  assert.equal(campaignRule.fieldMapping.source, "destination_config");
  assert.equal(utmRule.fieldMapping.source, "destination_config");
  assert.equal(campaignRule.fieldMapping.coreRequiredComplete, true);
  assert.equal(utmRule.fieldMapping.coreRequiredComplete, true);
});
