import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecisionItem } from "./types";
import { buildRoutingComparisonSummary } from "./routing-dry-run-comparison.ts";

const sample: RoutingDryRunDecisionItem = {
  id: "d1",
  createdAt: "2026-05-19T12:00:00.000Z",
  sourceEventUuid: null,
  sourceLeadUid: "lead_abc",
  matched: true,
  confidence: "high",
  matchType: "campaign_id",
  matchedRuleId: "rule_1",
  matchedRuleSummary: {
    id: "rule_1",
    clientDisplayName: "Agent Alpha",
    clientAccountId: "client_sa360",
    nicheKey: null,
    productType: null,
    matchType: "campaign_id",
  },
  destinationClientAccountId: "client_sa360",
  destinationSubaccountIdGhl: "loc_sa360",
  reason: "Matched",
  deliveryMode: "dry_run",
  routingEventNameInternal: "lead_matched",
  attributionSnapshot: { campaignId: "camp_1", campaignName: "Spring Promo" },
  lifecycleEventsEmitted: ["lead_matched"],
  leadIdentity: {
    contactIdGhl: "ct_1",
    firstName: "Jamie",
    lastName: "Lee",
    displayName: "Jamie Lee",
    phoneE164: null,
    email: null,
  },
  masterClientAccountId: "master_1",
  legacyDeliveredClientAccountId: "client_legacy",
  legacyDeliveredSubaccountIdGhl: "loc_legacy",
  legacyDeliveryContactIdGhl: "ct_legacy",
  legacyDeliveryStatus: "delivered",
  validationStatus: "mismatch",
  validationNotes: "Zapier sent to different subaccount",
  validatedAt: "2026-05-19T13:00:00.000Z",
  validatedBy: "ops",
  deliveryPlanSummary: { id: "plan_1", status: "needs_config", generatedAt: "2026-05-19T12:30:00.000Z" },
};

test("buildRoutingComparisonSummary includes lead campaign SA360 legacy and validation", () => {
  const text = buildRoutingComparisonSummary(sample);
  assert.match(text, /Jamie Lee \(lead_abc\)/);
  assert.match(text, /Spring Promo \(camp_1\)/);
  assert.match(text, /SA360 predicted client: Agent Alpha/);
  assert.match(text, /SA360 shadow delivery plan: Needs config/);
  assert.match(text, /Legacy delivered client: client_legacy/);
  assert.match(text, /Validation status: Mismatch/);
  assert.match(text, /Zapier sent to different subaccount/);
});
