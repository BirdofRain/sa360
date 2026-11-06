import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV,
  isDeliverySuccessNotifyEnabled,
} from "./delivery-success-notification-env.js";

test("delivery success notification stays off unless the flag is exact true", () => {
  assert.equal(isDeliverySuccessNotifyEnabled({}), false);
  assert.equal(
    isDeliverySuccessNotifyEnabled({ [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: undefined }),
    false
  );
  for (const value of ["", " ", "TRUE", "True", "1", "yes", "on", "false", "trueish"]) {
    assert.equal(
      isDeliverySuccessNotifyEnabled({ [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: value }),
      false,
      value
    );
  }
  assert.equal(
    isDeliverySuccessNotifyEnabled({ [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: "true" }),
    true
  );
  assert.equal(
    isDeliverySuccessNotifyEnabled({ [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: " true " }),
    true
  );
  assert.equal(
    isDeliverySuccessNotifyEnabled({ [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: "true\n" }),
    true
  );
});
