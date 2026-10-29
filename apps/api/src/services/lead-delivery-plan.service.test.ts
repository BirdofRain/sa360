import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignRoutingRule, ClientGhlDestination, RoutingDryRunDecision } from "@prisma/client";
import type { RoutingAttributionInput } from "../lib/routing-attribution-extract.js";
import {
  associationDestinationToPlanRule,
  CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID,
  missingDeliveryRuleBlocker,
} from "./association-ghl-delivery-source.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "./routing-source-association.service.js";
import {
  buildDirectCanaryDeliveryPlanSteps,
  buildShadowDeliveryPlanSteps,
  deriveDirectCanaryPlanStatusFromSteps,
  derivePlanStatusFromSteps,
} from "./lead-delivery-plan.service.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function rule(
  partial: Partial<CampaignRoutingRule> & Pick<CampaignRoutingRule, "id" | "clientAccountId">
): CampaignRoutingRule {
  return {
    masterClientAccountId: "master_1",
    destinationSubaccountIdGhl: "loc_dest",
    clientDisplayName: "Agent A",
    nicheKey: "VET",
    productType: "Final Expense",
    sourcePlatform: "facebook",
    sourceType: "facebook_lead_form",
    campaignId: "camp_100",
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

function decision(
  partial: Partial<RoutingDryRunDecision> & Pick<RoutingDryRunDecision, "id" | "matched">
): RoutingDryRunDecision {
  return {
    masterClientAccountId: "master_1",
    sourceEventUuid: "ev_1",
    sourceLeadUid: "lead_1",
    confidence: "high",
    matchedRuleId: partial.matched ? "rule_1" : null,
    destinationClientAccountId: partial.matched ? "client_a" : null,
    destinationSubaccountIdGhl: partial.matched ? "loc_dest" : null,
    matchReason: partial.matched ? "Matched" : "No match",
    deliveryMode: "dry_run",
    routingEventNameInternal: partial.matched ? "lead_matched" : "routing_review_required",
    attributionSnapshot: null,
    createdAt: NOW,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    ...partial,
    cleanupStatus: partial.cleanupStatus ?? null,
    cleanupReason: partial.cleanupReason ?? null,
    cleanupMarkedAt: partial.cleanupMarkedAt ?? null,
  };
}

const attr: RoutingAttributionInput = {
  masterClientAccountId: "master_1",
  campaignId: "camp_100",
  sourcePlatform: "facebook",
  sourceType: "facebook_lead_form",
};

test("matched decision generates plan with create_or_update_contact and stamp steps", () => {
  const { steps, warnings } = buildShadowDeliveryPlanSteps({
    decision: decision({ id: "d1", matched: true }),
    matched: true,
    rule: rule({ id: "rule_1", clientAccountId: "client_a" }),
    attribution: attr,
    leadIdentity: {
      contactIdGhl: null,
      firstName: "Alex",
      lastName: "Lee",
      displayName: "Alex Lee",
      phoneE164: "+15551234567",
      email: "alex@example.com",
    },
  });
  assert.equal(warnings.length, 0);
  const types = steps.map((s) => s.stepType);
  assert.ok(types.includes("create_or_update_contact"));
  assert.ok(types.includes("stamp_custom_fields"));
  const contact = steps.find((s) => s.stepType === "create_or_update_contact");
  assert.equal(contact?.targetSystem, "ghl");
  assert.equal(contact?.status, "planned");
  const stamp = steps.find((s) => s.stepType === "stamp_custom_fields");
  const preview = stamp?.requestPreviewJson as { customFields?: Record<string, string> };
  assert.equal(preview?.customFields?.sa360_routing_status, "ROUTED_SHADOW");
});

test("unmatched decision creates blocked plan with review step", () => {
  const { steps } = buildShadowDeliveryPlanSteps({
    decision: decision({ id: "d2", matched: false }),
    matched: false,
    rule: null,
    attribution: attr,
    leadIdentity: null,
  });
  assert.equal(derivePlanStatusFromSteps(steps, false), "blocked");
  assert.equal(steps[0]?.stepType, "mark_ready_for_delivery_review");
});

test("workflow step is needs_config when workflow ID missing", () => {
  const { steps } = buildShadowDeliveryPlanSteps({
    decision: decision({ id: "d3", matched: true }),
    matched: true,
    rule: rule({ id: "rule_1", clientAccountId: "client_a", destinationWorkflowIdGhl: null }),
    attribution: attr,
    leadIdentity: null,
  });
  const wf = steps.find((s) => s.stepType === "start_workflow");
  assert.equal(wf?.status, "needs_config");
});

test("backup sheet step is skipped when disabled", () => {
  const { steps } = buildShadowDeliveryPlanSteps({
    decision: decision({ id: "d4", matched: true }),
    matched: true,
    rule: rule({ id: "rule_1", clientAccountId: "client_a", backupSheetEnabled: false }),
    attribution: attr,
    leadIdentity: null,
  });
  const sheet = steps.find((s) => s.stepType === "write_backup_sheet");
  assert.equal(sheet?.status, "skipped");
});

test("plan status becomes needs_config when any step needs_config", () => {
  const { steps } = buildShadowDeliveryPlanSteps({
    decision: decision({ id: "d5", matched: true }),
    matched: true,
    rule: rule({ id: "rule_1", clientAccountId: "client_a" }),
    attribution: attr,
    leadIdentity: null,
  });
  assert.equal(derivePlanStatusFromSteps(steps, true), "needs_config");
});

test("shadow plan warns Phase 4D when deliveryEnabled is true", () => {
  const { warnings } = buildShadowDeliveryPlanSteps({
    decision: decision({ id: "d6", matched: true }),
    matched: true,
    rule: rule({
      id: "rule_1",
      clientAccountId: "client_a",
      deliveryEnabled: true,
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
      destinationWorkflowIdGhl: "wf_1",
      defaultAssignedUserIdGhl: "user_1",
    }),
    attribution: attr,
    leadIdentity: null,
    duplicateRisk: {
      riskLevel: "none",
      confidence: "high",
      reasons: [],
      candidateMatches: [],
      recommendedAction: "",
      identityStatus: "linked",
      blocksLiveDelivery: false,
      isWarningOnly: false,
    },
  });
  assert.ok(
    warnings.some((w) => w.includes("Phase 4D only records shadow plans")),
    "expected Phase 4D shadow warning"
  );
});

test("direct canary plan is planned when pipeline configured without workflow/owner", () => {
  const { steps, warnings } = buildDirectCanaryDeliveryPlanSteps({
    decision: decision({ id: "d7", matched: true }),
    matched: true,
    rule: rule({
      id: "rule_1",
      clientAccountId: "client_a",
      deliveryEnabled: true,
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
      destinationWorkflowIdGhl: null,
      defaultAssignedUserIdGhl: null,
    }),
    attribution: attr,
    leadIdentity: null,
    duplicateRisk: {
      riskLevel: "none",
      confidence: "high",
      reasons: [],
      candidateMatches: [],
      recommendedAction: "",
      identityStatus: "linked",
      blocksLiveDelivery: false,
      isWarningOnly: false,
    },
  });
  assert.equal(
    warnings.some((w) => w.includes("Phase 4D")),
    false,
    "direct canary must not emit Phase 4D shadow warning"
  );
  assert.equal(deriveDirectCanaryPlanStatusFromSteps(steps, true), "planned");
  const wf = steps.find((s) => s.stepType === "start_workflow");
  const owner = steps.find((s) => s.stepType === "assign_owner");
  assert.equal(wf?.status, "skipped");
  assert.equal(owner?.status, "skipped");
});

test("confirmed source association plans GHL workflow from the destination, not a campaign rule", () => {
  const workflowId = "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd";
  const locationId = "yCziKRW26eFg8IXAQZ73";
  const planRule = associationDestinationToPlanRule({
    masterClientAccountId: "lal_master_vet",
    clientDisplayName: "Alex Gross",
    destinationSubaccountIdGhl: locationId,
    destination: {
      clientAccountId: "alex_gross",
      destinationSubaccountIdGhl: locationId,
      locationName: "Test Sam CRM",
      destinationWorkflowIdGhl: workflowId,
      destinationPipelineIdGhl: "QBIEpeXqzvF2JAmbBSIR",
      destinationPipelineStageIdGhl: "b5b3729f-d3ae-4185-84c4-2d0dc3417e81",
      defaultAssignedUserIdGhl: null,
      opportunityCreationEnabled: true,
      backupSheetEnabled: false,
      backupSheetId: null,
      ghlConnectionStatus: "connected",
      snapshotInstalled: false,
      requiredFieldsInstalled: false,
      deliveryMode: "shadow",
      deliveryEnabled: false,
      clientCutoverApproved: false,
      internalApprovalStatus: "not_reviewed",
      sourceAttributeFieldMapJson: {},
      sourceFieldAliasOverridesJson: {},
      createdAt: NOW,
      updatedAt: NOW,
    } as ClientGhlDestination,
  });
  assert.equal(planRule.id, CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID);
  assert.equal(planRule.deliveryEnabled, false);
  assert.equal(planRule.deliveryMode, "shadow");
  assert.equal(planRule.clientCutoverApproved, false);
  assert.equal(planRule.snapshotInstalled, false);

  const { steps, warnings } = buildDirectCanaryDeliveryPlanSteps({
    decision: decision({
      id: "d-assoc",
      matched: true,
      matchedRuleId: null,
      destinationClientAccountId: "alex_gross",
      destinationSubaccountIdGhl: locationId,
      attributionSnapshot: {
        routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
        sourceAssociation: {
          matchedBy: "parent_url_key",
          parentUrlKey: "go.lifeinsuranceforvets.com/learn-alex-gross",
        },
      },
    }),
    matched: true,
    rule: planRule,
    attribution: {
      ...attr,
      campaignId: "UNKNOWN_ROUTE",
      utmCampaign: "Alex Gross- Vet Web Form- 10/26/26",
    },
    leadIdentity: null,
    duplicateRisk: {
      riskLevel: "none",
      confidence: "high",
      reasons: [],
      candidateMatches: [],
      recommendedAction: "",
      identityStatus: "linked",
      blocksLiveDelivery: false,
      isWarningOnly: false,
    },
  });

  assert.equal(deriveDirectCanaryPlanStatusFromSteps(steps, true), "planned");
  assert.equal(
    warnings.some((warning) => warning.includes("No matched routing rule")),
    false
  );
  const workflow = steps.find((step) => step.stepType === "start_workflow");
  const preview = workflow?.requestPreviewJson as { workflowId?: string; locationId?: string };
  assert.equal(workflow?.status, "planned");
  assert.equal(preview?.workflowId, workflowId);
  assert.equal(preview?.locationId, locationId);
  const stamp = steps.find((step) => step.stepType === "stamp_custom_fields");
  const fields = (stamp?.requestPreviewJson as { customFields?: Record<string, string | null> })
    .customFields;
  assert.equal(fields?.sa360_campaign_id, "UNKNOWN_ROUTE");
  assert.equal(fields?.sa360_utm_campaign, "Alex Gross- Vet Web Form- 10/26/26");
});

test("association without a GHL destination is not reported as a missing campaign rule", () => {
  const { steps, warnings } = buildDirectCanaryDeliveryPlanSteps({
    decision: decision({
      id: "d-assoc-gap",
      matched: true,
      matchedRuleId: null,
      destinationClientAccountId: "alex_gross",
    }),
    matched: true,
    rule: null,
    routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
    attribution: attr,
    leadIdentity: null,
  });
  assert.equal(steps[0]?.status, "blocked");
  assert.equal(warnings[0], missingDeliveryRuleBlocker(true));
  assert.match(steps[0]?.description ?? "", /no GHL destination/);
  assert.equal(
    warnings.some((warning) => warning.includes("No matched routing rule")),
    false
  );
});
