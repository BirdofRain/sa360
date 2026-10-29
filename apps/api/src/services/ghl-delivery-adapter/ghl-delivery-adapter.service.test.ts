import test from "node:test";
import assert from "node:assert/strict";
import type {
  CampaignRoutingRule,
  ClientGhlDestination,
  LeadDeliveryPlan,
  LeadDeliveryPlanStep,
} from "@prisma/client";
import {
  buildContactUpsertRequest,
  buildCustomFieldStampRequest,
  validateDeliveryPlanForGhlSimulation,
  validateOpportunityConfig,
  validateWorkflowStartConfig,
} from "./ghl-delivery-request-builders.js";
import { assertGhlLiveModeNotAllowed } from "./ghl-delivery-adapter.service.js";
import {
  assertGhlWriteTransportNotUsed,
  isGhlWriteTransportAllowed,
} from "./ghl-delivery-disabled-transport.js";
import { getGhlDeliveryAdapterMode } from "../../lib/ghl-delivery-adapter-mode.js";
import {
  associationDestinationToPlanRule,
  CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID,
} from "../association-ghl-delivery-source.js";
const NOW = new Date();

function planWithSteps(rule: CampaignRoutingRule | null): {
  plan: LeadDeliveryPlan & { steps: LeadDeliveryPlanStep[] };
  rule: CampaignRoutingRule | null;
} {
  const plan: LeadDeliveryPlan & { steps: LeadDeliveryPlanStep[] } = {
    id: "plan_1",
    routingDryRunDecisionId: "dec_1",
    lifecycleEventId: null,
    masterClientAccountId: "master_1",
    sourceLeadUid: "lead_1",
    sourceContactIdGhl: null,
    sourcePhoneE164: "+15551234567",
    sourceEmail: "a@example.com",
    destinationClientAccountId: "client_dest",
    destinationSubaccountIdGhl: "loc_dest",
    destinationClientDisplayName: "Agent",
    nicheKey: "VET",
    productType: null,
    deliveryMode: "shadow",
    status: "planned",
    planVersion: "1.0",
    generatedAt: NOW,
    generatedBy: "sa360_shadow_delivery",
    summary: null,
    warnings: null,
    createdAt: NOW,
    updatedAt: NOW,
    steps: [],
  };
  return { plan, rule };
}

function fullRule(overrides: Partial<CampaignRoutingRule> = {}): CampaignRoutingRule {
  return {
    id: "rule_1",
    masterClientAccountId: "master_1",
    clientAccountId: "client_dest",
    destinationSubaccountIdGhl: "loc_dest",
    clientDisplayName: "Agent",
    locationName: null,
    nicheKey: "VET",
    productType: null,
    sourcePlatform: "facebook",
    sourceType: null,
    campaignId: "camp_1",
    campaignName: null,
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: null,
    utmContent: null,
    masterDatasetId: null,
    matchType: "campaign_id",
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
    ...overrides,
  };
}

test("default adapter max mode is simulate when env missing", () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevMax = process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  delete process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
  assert.equal(getGhlDeliveryAdapterMode(), "simulate");
  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  if (prevMax !== undefined) process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = prevMax;
});

test("buildContactUpsertRequest includes location and custom fields", () => {
  const rule = fullRule();
  const { plan } = planWithSteps(rule);
  const req = buildContactUpsertRequest({ plan, rule });
  assert.equal(req.locationId, "loc_dest");
  assert.equal(req.body.customFields.sa360_backend_sync_status, "GHL_ADAPTER_SIMULATED");
});

test("buildCustomFieldStampRequest includes sa360 fields", () => {
  const rule = fullRule();
  const { plan } = planWithSteps(rule);
  const req = buildCustomFieldStampRequest({ plan, rule });
  assert.equal(req.customFields.sa360_lifecycle_stage, "NEW");
});

test("validateWorkflowStartConfig flags missing workflow ID", () => {
  const rule = fullRule({ destinationWorkflowIdGhl: null });
  const { plan } = planWithSteps(rule);
  const v = validateWorkflowStartConfig({ plan, rule });
  assert.equal(v.valid, false);
  assert.ok(v.missingConfig.includes("destinationWorkflowIdGhl"));
});

test("validateOpportunityConfig flags missing pipeline when enabled", () => {
  const rule = fullRule({ destinationPipelineIdGhl: null, opportunityCreationEnabled: true });
  const { plan } = planWithSteps(rule);
  const v = validateOpportunityConfig({ plan, rule });
  assert.equal(v.valid, false);
});

test("association destination rule satisfies adapter simulation without a campaign rule row", () => {
  const locationId = "yCziKRW26eFg8IXAQZ73";
  const workflowId = "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd";
  const rule = associationDestinationToPlanRule({
    masterClientAccountId: "lal_master_vet",
    clientDisplayName: "Alex Gross",
    destinationSubaccountIdGhl: locationId,
    destination: {
      clientAccountId: "alex_gross",
      destinationSubaccountIdGhl: locationId,
      destinationWorkflowIdGhl: workflowId,
      destinationPipelineIdGhl: "QBIEpeXqzvF2JAmbBSIR",
      destinationPipelineStageIdGhl: "b5b3729f-d3ae-4185-84c4-2d0dc3417e81",
      opportunityCreationEnabled: true,
      deliveryMode: "shadow",
      deliveryEnabled: false,
      clientCutoverApproved: false,
      snapshotInstalled: false,
      requiredFieldsInstalled: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as ClientGhlDestination,
  });
  const { plan } = planWithSteps(rule);
  plan.destinationSubaccountIdGhl = locationId;
  plan.sourceLeadUid = "lead_assoc";
  const validation = validateDeliveryPlanForGhlSimulation({ plan, rule });
  assert.equal(rule.id, CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID);
  assert.equal(validation.valid, true);
  assert.equal(
    validation.errors.includes("No CampaignRoutingRule linked to this delivery plan."),
    false
  );
});

test("validateDeliveryPlanForGhlSimulation flags missing subaccount", () => {
  const rule = fullRule();
  const { plan } = planWithSteps(rule);
  plan.destinationSubaccountIdGhl = "";
  const v = validateDeliveryPlanForGhlSimulation({ plan, rule });
  assert.equal(v.valid, false);
});

test("assertGhlLiveModeNotAllowed throws", () => {
  assert.throws(() => assertGhlLiveModeNotAllowed("live"), /Phase 4H/);
});

test("write transport is never allowed in Phase 4H", () => {
  assert.equal(isGhlWriteTransportAllowed(), false);
  assert.throws(() => assertGhlWriteTransportNotUsed("POST /contacts"), /Phase 4H/);
});
