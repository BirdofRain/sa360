import assert from "node:assert/strict";
import test from "node:test";

import { isCustomWebhookDeliveryEnabled } from "./custom-webhook-env.js";

test("custom webhook delivery flag is exact trim true", () => {
  assert.equal(isCustomWebhookDeliveryEnabled({}), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: undefined }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "false" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "TRUE" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "True" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "1" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "yes" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "on" }), false);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: " true " }), true);
  assert.equal(isCustomWebhookDeliveryEnabled({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "true" }), true);
});
