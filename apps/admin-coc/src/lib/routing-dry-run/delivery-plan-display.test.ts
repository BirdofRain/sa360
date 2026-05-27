import test from "node:test";
import assert from "node:assert/strict";
import {
  deliveryPlanStatusLabel,
  deliveryPlanSummaryLabel,
} from "./delivery-plan-display.ts";

test("deliveryPlanStatusLabel for planned and not generated", () => {
  assert.equal(deliveryPlanStatusLabel("planned"), "Planned");
  assert.equal(deliveryPlanStatusLabel(null), "Not generated");
});

test("deliveryPlanSummaryLabel uses summary status", () => {
  assert.equal(
    deliveryPlanSummaryLabel({ id: "p1", status: "needs_config", generatedAt: "2026-01-01T00:00:00.000Z" }),
    "Needs config"
  );
});
