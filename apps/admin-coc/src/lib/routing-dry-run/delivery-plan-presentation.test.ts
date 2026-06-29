import test from "node:test";
import assert from "node:assert/strict";

import { getDeliveryPlanPresentation } from "./delivery-plan-presentation.ts";
import type { LeadDeliveryPlanItem, LeadDeliveryPlanSummary, RoutingDryRunDecisionItem } from "./types.ts";

type Row = Parameters<typeof getDeliveryPlanPresentation>[0]["row"];

function row(overrides: Partial<RoutingDryRunDecisionItem> = {}): Row {
  return {
    matched: true,
    matchedRuleId: "rule_1",
    validationStatus: "validated_match",
    deliveryReadiness: null,
    deliveryMode: "dry_run",
    deliveryPlanSummary: null,
    ...overrides,
  } as Row;
}

const summary: LeadDeliveryPlanSummary = {
  id: "cmqzb4v9x003tj40u0iw8stdr",
  status: "planned",
  deliveryMode: "shadow",
  generatedAt: "2026-06-29T00:00:00.000Z",
};

test("existing plan summary (deliveryPlanId present) enables View and is never 'unavailable'", () => {
  // Even when generate-eligibility is blocked (unreviewed), an existing plan stays viewable.
  const p = getDeliveryPlanPresentation({
    row: row({ validationStatus: "unreviewed", deliveryPlanSummary: summary }),
    plan: null,
  });
  assert.equal(p.planExists, true);
  assert.equal(p.canView, true);
  assert.equal(p.showUnavailable, false);
  assert.equal(p.displayStatus, "planned");
  assert.equal(p.deliveryMode, "shadow");
});

test("no plan and not eligible shows 'unavailable' and cannot view", () => {
  const p = getDeliveryPlanPresentation({
    row: row({ matched: false, matchedRuleId: null, deliveryPlanSummary: null }),
    plan: null,
  });
  assert.equal(p.planExists, false);
  assert.equal(p.canView, false);
  assert.equal(p.showUnavailable, true);
  assert.equal(p.canGenerate, false);
  // Falls back to the decision's delivery mode when no plan exists.
  assert.equal(p.deliveryMode, "dry_run");
});

test("matched + config complete allows generate in shadow workflow", () => {
  const p = getDeliveryPlanPresentation({ row: row(), plan: null });
  assert.equal(p.canGenerate, true);
  assert.equal(p.showUnavailable, false);
});

test("loaded full plan takes precedence over summary for status and mode", () => {
  const plan: LeadDeliveryPlanItem = {
    id: "plan_full",
    routingDryRunDecisionId: "dec_1",
    status: "needs_config",
    deliveryMode: "shadow",
    summary: null,
    warnings: [],
    generatedAt: "2026-06-29T01:00:00.000Z",
    steps: [],
  };
  const p = getDeliveryPlanPresentation({
    row: row({ deliveryPlanSummary: summary }),
    plan,
  });
  assert.equal(p.displayStatus, "needs_config");
  assert.equal(p.deliveryMode, "shadow");
  // Full plan already loaded → no "View" button needed.
  assert.equal(p.canView, false);
});
