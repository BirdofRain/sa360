import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignRoutingRule, RoutingDryRunDecision } from "@prisma/client";
import type { RoutingAttributionInput } from "../lib/routing-attribution-extract.js";
import {
  buildShadowDeliveryPlanSteps,
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
