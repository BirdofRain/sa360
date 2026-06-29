import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLeadDeliveryPlan,
  normalizeRoutingDryRunDecisionItem,
} from "./routing-dry-run-safe.ts";

test("normalizeLeadDeliveryPlan tolerates missing warnings and steps", () => {
  const plan = normalizeLeadDeliveryPlan({
    id: "plan_1",
    status: "planned",
    deliveryMode: "shadow",
    generatedAt: "2026-06-29T00:00:00.000Z",
  });
  assert.ok(plan);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.deliveryMode, "shadow");
});

test("normalizeLeadDeliveryPlan returns null for non-object / missing id", () => {
  for (const raw of [null, undefined, 42, "x", [], {}]) {
    assert.equal(normalizeLeadDeliveryPlan(raw as never), null);
  }
});

test("normalizeLeadDeliveryPlan backfills step id and filters non-object steps", () => {
  const plan = normalizeLeadDeliveryPlan({
    id: "plan_2",
    status: "planned",
    deliveryMode: "shadow",
    generatedAt: "2026-06-29T00:00:00.000Z",
    warnings: ["w1", 5, null, "w2"],
    steps: [
      { stepType: "normalize_lead", status: "planned", title: "Normalize" },
      null,
      "nope",
      { id: "s3", stepType: "add_tags", status: "planned", title: "Tags", warnings: ["x", 1] },
    ],
  });
  assert.ok(plan);
  assert.deepEqual(plan.warnings, ["w1", "w2"]);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0]?.id, "step-0");
  assert.equal(plan.steps[0]?.stepOrder, 1);
  assert.equal(plan.steps[1]?.id, "s3");
  assert.deepEqual(plan.steps[1]?.warnings, ["x"]);
});

test("normalizeRoutingDryRunDecisionItem carries deliveryMode onto the plan summary (default shadow)", () => {
  const item = normalizeRoutingDryRunDecisionItem({
    id: "dec_1",
    deliveryPlanSummary: { id: "plan_1", status: "planned", generatedAt: "2026-06-29T00:00:00.000Z" },
  });
  assert.equal(item.deliveryPlanSummary?.deliveryMode, "shadow");

  const item2 = normalizeRoutingDryRunDecisionItem({
    id: "dec_2",
    deliveryPlanSummary: {
      id: "plan_2",
      status: "planned",
      deliveryMode: "shadow",
      generatedAt: "2026-06-29T00:00:00.000Z",
    },
  });
  assert.equal(item2.deliveryPlanSummary?.deliveryMode, "shadow");
});
