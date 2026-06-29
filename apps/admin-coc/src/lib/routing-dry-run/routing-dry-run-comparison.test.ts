import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutingComparisonSummary } from "./routing-dry-run-comparison.ts";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";

const sample = routingDryRunDecisionFixture({
  sourceLeadUid: "lead_abc",
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
  attributionSnapshot: { campaignId: "camp_1", campaignName: "Spring Promo" },
  leadIdentity: {
    contactIdGhl: "ct_1",
    firstName: "Jamie",
    lastName: "Lee",
    displayName: "Jamie Lee",
    phoneE164: null,
    email: null,
  },
  legacyDeliveredClientAccountId: "client_legacy",
  legacyDeliveredSubaccountIdGhl: "loc_legacy",
  legacyDeliveryContactIdGhl: "ct_legacy",
  legacyDeliveryStatus: "delivered",
  validationStatus: "mismatch",
  validationNotes: "Zapier sent to different subaccount",
  validatedAt: "2026-05-19T13:00:00.000Z",
  validatedBy: "ops",
  deliveryPlanSummary: {
    id: "plan_1",
    status: "needs_config",
    deliveryMode: "shadow",
    generatedAt: "2026-05-19T12:30:00.000Z",
  },
  suggestedValidation: {
    suggestedValidationStatus: "mismatch",
    suggestedValidationReason: "Legacy subaccount differs from SA360 destination.",
    suggestionConfidence: "high",
  },
});

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
