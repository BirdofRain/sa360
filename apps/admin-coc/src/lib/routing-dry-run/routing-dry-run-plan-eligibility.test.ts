import test from "node:test";
import assert from "node:assert/strict";
import { getDeliveryPlanEligibility } from "./routing-dry-run-plan-eligibility.ts";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";
import { DELIVERY_PLAN_BLOCKED_MESSAGE } from "./routing-dry-run-safe.ts";

test("legacy_unknown row cannot generate delivery plan", () => {
  const row = routingDryRunDecisionFixture({
    matched: true,
    matchedRuleId: "rule_1",
    validationStatus: "legacy_unknown",
  });
  const e = getDeliveryPlanEligibility(row);
  assert.equal(e.allowed, false);
  assert.equal(e.message, DELIVERY_PLAN_BLOCKED_MESSAGE);
});

test("unreviewed matched row cannot generate delivery plan", () => {
  const row = routingDryRunDecisionFixture({
    matched: true,
    matchedRuleId: "rule_1",
    validationStatus: "unreviewed",
  });
  assert.equal(getDeliveryPlanEligibility(row).allowed, false);
});

test("unmatched row cannot generate delivery plan", () => {
  const row = routingDryRunDecisionFixture({ matched: false, matchedRuleId: null });
  assert.equal(getDeliveryPlanEligibility(row).allowed, false);
});

test("matched row with complete config can generate plan", () => {
  const row = routingDryRunDecisionFixture({
    matched: true,
    matchedRuleId: "rule_1",
    validationStatus: "matched_legacy",
    deliveryReadiness: {
      ruleId: "rule_1",
      clientAccountId: "client_1",
      destinationSubaccountIdGhl: "loc_1",
      clientDisplayName: null,
      readyForShadow: true,
      readyForLive: false,
      canDeliverLive: false,
      readinessStatus: "ready_for_shadow",
      blockers: [],
      warnings: [],
      missingConfig: [],
      requiredApprovals: [],
      recommendedNextAction: "ok",
      checklist: [],
    },
  });
  assert.equal(getDeliveryPlanEligibility(row).allowed, true);
});
