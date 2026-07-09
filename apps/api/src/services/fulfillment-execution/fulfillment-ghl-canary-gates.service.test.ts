import test from "node:test";
import assert from "node:assert/strict";

import { validateLf2GhlCanaryExecuteBody } from "./fulfillment-ghl-canary-gates.service.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";

test("validateLf2GhlCanaryExecuteBody requires exact confirmation text", () => {
  const errors = validateLf2GhlCanaryExecuteBody({
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: "WRONG",
  });
  assert.ok(errors.some((entry) => entry.includes(LIVE_CANARY_CONFIRMATION_TEXT)));

  const ok = validateLf2GhlCanaryExecuteBody({
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
  });
  assert.equal(ok.length, 0);
});
