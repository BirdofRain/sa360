import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";

import { EXTERNAL_WEBHOOK_DELIVERY_JOB } from "@sa360/shared";

import {
  isExternalWebhookWorkerEnabled,
  processExternalWebhookDeliveryJob,
} from "./external-webhook-delivery.processor.js";

function job(name: string, data: unknown = {}): Job {
  return { name, data } as Job;
}

test("the external webhook worker stays off unless the flag is exact true", async () => {
  assert.equal(isExternalWebhookWorkerEnabled({ SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "true" }), true);
  assert.equal(isExternalWebhookWorkerEnabled({ SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "TRUE" }), false);
  assert.equal(isExternalWebhookWorkerEnabled({ SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "1" }), false);
  let calls = 0;
  const skipped = await processExternalWebhookDeliveryJob(job(EXTERNAL_WEBHOOK_DELIVERY_JOB, { attemptId: "att_1" }), {
    env: { SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "TRUE", ADMIN_API_KEY: "admin" },
    postImpl: async () => {
      calls += 1;
      return { status: 200, body: "" };
    },
  });
  assert.equal(skipped.skipped, "flag_off");
  assert.equal(calls, 0);

  const sent = await processExternalWebhookDeliveryJob(job(EXTERNAL_WEBHOOK_DELIVERY_JOB, { attemptId: "att_1" }), {
    env: { SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "true", ADMIN_API_KEY: "admin" },
    postImpl: async (input) => {
      calls += 1;
      assert.equal(input.url.endsWith("/admin/v1/external-webhook/internal/deliver"), true);
      assert.equal(input.url.includes("ghl"), false);
      assert.equal(input.url.includes("company-sheets"), false);
      assert.equal(input.body, JSON.stringify({ attemptId: "att_1" }));
      return { status: 200, body: "{\"ok\":true}" };
    },
  });
  assert.equal(sent.ok, true);
  assert.equal(calls, 1);
});
