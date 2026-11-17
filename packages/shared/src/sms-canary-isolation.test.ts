import assert from "node:assert/strict";
import test from "node:test";

import { readSmsCanaryIsolation } from "./sms-canary-isolation.js";

test("canary isolation stays off until a canary variable is set", () => {
  assert.deepEqual(readSmsCanaryIsolation({}), { mode: "off" });
  assert.equal(readSmsCanaryIsolation({ SA360_SMS_CANARY_ENABLED: "TRUE" }).mode, "holding");
  assert.equal(readSmsCanaryIsolation({ SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: "sandbox" }).mode, "holding");
  assert.equal(
    readSmsCanaryIsolation({
      SA360_SMS_CANARY_ENABLED: "true",
      SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: "sandbox",
      SA360_SMS_CANARY_ATTEMPT_ID: "attempt",
      SA360_SMS_CANARY_RECIPIENT_E164: "5555550100",
    }).mode,
    "holding"
  );
});

test("a ready canary names one client, one attempt, and one E.164", () => {
  assert.deepEqual(
    readSmsCanaryIsolation({
      SA360_SMS_CANARY_ENABLED: "true",
      SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: " sandbox_client ",
      SA360_SMS_CANARY_ATTEMPT_ID: "attempt_1",
      SA360_SMS_CANARY_RECIPIENT_E164: "+15555550100",
    }),
    {
      mode: "ready",
      clientAccountId: "sandbox_client",
      attemptId: "attempt_1",
      recipientE164: "+15555550100",
    }
  );
});
