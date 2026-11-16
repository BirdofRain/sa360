import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";

import { EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB, EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB } from "@sa360/shared";

import {
  isExternalWebhookNoticeWorkerEnabled,
  processExternalWebhookNoticeJob,
} from "./external-webhook-notice.processor.js";

function job(name: string, data: unknown = {}): Job {
  return { name, data } as Job;
}

test("the notice worker stays off unless its own flag is exact true", async () => {
  assert.equal(isExternalWebhookNoticeWorkerEnabled({}), false);
  assert.equal(isExternalWebhookNoticeWorkerEnabled({ SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "TRUE" }), false);
  let calls = 0;
  const skipped = await processExternalWebhookNoticeJob(job(EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB, { receiptId: "rcpt_1" }), {
    env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "1", ADMIN_API_KEY: "admin" },
    postImpl: async () => {
      calls += 1;
      return { status: 200, body: "" };
    },
  });
  assert.equal(skipped.skipped, "flag_off");
  assert.equal(calls, 0);
  const sent = await processExternalWebhookNoticeJob(job(EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB), {
    env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true", ADMIN_API_KEY: "admin" },
    postImpl: async (input) => {
      calls += 1;
      assert.equal(input.url.endsWith("/admin/v1/external-webhook-notice/internal/discover"), true);
      assert.equal(input.body, "{}");
      return { status: 200, body: "{\"ok\":true}" };
    },
  });
  assert.equal(sent.ok, true);
  assert.equal(calls, 1);
});
