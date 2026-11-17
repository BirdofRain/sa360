import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import { dispatchExternalWebhookNotice } from "./notice-dispatch.js";
import { runIsolatedSmsCanary } from "./sms-canary.js";

test("a mismatched canary fails closed before any provider call", async () => {
  let providerCalls = 0;
  const sender = async () => {
    providerCalls += 1;
    throw new Error("provider");
  };
  const db = {
    externalWebhookNotificationReceipt: {
      findUnique: async () => ({
        id: "receipt_1",
        status: "pending",
        channel: "sms",
        clientAccountId: "client_a",
        attemptId: "attempt_a",
        recipient: "+15555550100",
        idempotencyKey: "key_1",
      }),
    },
  } as unknown as PrismaClient;
  const holding = await dispatchExternalWebhookNotice(db, "receipt_1", {
    env: { SA360_SMS_CANARY_ENABLED: "true", SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    sms: sender,
  });
  const mismatched = await dispatchExternalWebhookNotice(db, "receipt_1", {
    env: {
      SA360_SMS_CANARY_ENABLED: "true",
      SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: "other_client",
      SA360_SMS_CANARY_ATTEMPT_ID: "attempt_a",
      SA360_SMS_CANARY_RECIPIENT_E164: "+15555550100",
      SA360_SMS_NOTIFICATIONS_ENABLED: "true",
    },
    sms: sender,
  });
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error("database");
      },
    }
  ) as PrismaClient;
  const blocked = await runIsolatedSmsCanary(untouched, {
    attemptId: "attempt_a",
    env: { SA360_SMS_CANARY_ENABLED: "true", SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    sms: sender,
  });
  assert.equal(holding.skipped, "canary_isolation");
  assert.equal(mismatched.skipped, "canary_isolation");
  assert.equal(blocked.skipped, "canary_isolation");
  assert.equal(blocked.smsCalls, 0);
  assert.equal(providerCalls, 0);
});
