import test from "node:test";
import assert from "node:assert/strict";
import { routingRuleDeliveryConfigPatchSchema } from "./delivery-readiness.schema.js";

test("routingRuleDeliveryConfigPatchSchema accepts safe config fields", () => {
  const r = routingRuleDeliveryConfigPatchSchema.safeParse({
    destinationWorkflowIdGhl: "wf_1",
    snapshotInstalled: true,
    deliveryMode: "shadow",
  });
  assert.equal(r.success, true);
});

test("routingRuleDeliveryConfigPatchSchema accepts confirmLiveDeliveryRisk", () => {
  const r = routingRuleDeliveryConfigPatchSchema.safeParse({
    deliveryEnabled: true,
    deliveryMode: "live",
    confirmLiveDeliveryRisk: true,
  });
  assert.equal(r.success, true);
});
