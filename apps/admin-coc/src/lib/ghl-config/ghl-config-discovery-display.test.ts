import test from "node:test";
import assert from "node:assert/strict";
import {
  formatGhlMissingConfigInlineMessage,
  hasGhlDeliveryConfigMissing,
} from "./ghl-config-discovery-display.ts";

test("hasGhlDeliveryConfigMissing detects destination GHL IDs", () => {
  assert.equal(hasGhlDeliveryConfigMissing(["destinationWorkflowIdGhl"]), true);
  assert.equal(hasGhlDeliveryConfigMissing(["requiredFieldsInstalled"]), false);
});

test("formatGhlMissingConfigInlineMessage lists missing keys", () => {
  const msg = formatGhlMissingConfigInlineMessage([
    "destinationWorkflowIdGhl",
    "destinationPipelineIdGhl",
  ]);
  assert.match(msg ?? "", /Delivery config incomplete/i);
  assert.match(msg ?? "", /destinationWorkflowIdGhl/);
  assert.match(msg ?? "", /destinationPipelineIdGhl/);
});

test("formatGhlMissingConfigInlineMessage returns null when empty", () => {
  assert.equal(formatGhlMissingConfigInlineMessage([]), null);
});
