import assert from "node:assert/strict";
import test from "node:test";

import { cocOrderUpdateFromBody } from "./coc-order-review-route.ts";

test("COC order notes keep the existing editable fields", () => {
  const parsed = cocOrderUpdateFromBody({
    status: "paused",
    adminNotes: "Hold for compliance",
    routingRuleId: "rule_1",
    campaignId: null,
    reservedQuantity: 4,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.input, {
    status: "paused",
    adminNotes: "Hold for compliance",
    routingRuleId: "rule_1",
    campaignId: null,
  });
});

test("COC order update refuses activation", () => {
  const parsed = cocOrderUpdateFromBody({ status: "active", adminNotes: "now" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.status, 409);
  assert.equal(parsed.code, "activation_requires_fulfillment_ops");
});
