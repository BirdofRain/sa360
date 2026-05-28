import test from "node:test";
import assert from "node:assert/strict";
import { requiresLiveConfirmation } from "./routing-rule-delivery-config.service.js";

test("requiresLiveConfirmation when enabling live delivery flags", () => {
  assert.equal(requiresLiveConfirmation({ deliveryEnabled: true }), true);
  assert.equal(requiresLiveConfirmation({ deliveryMode: "live" }), true);
  assert.equal(requiresLiveConfirmation({ deliveryMode: "shadow" }), false);
});
