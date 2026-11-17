import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";

import { GHL_LEAD_NOTICE_DISCOVER_JOB, GHL_LEAD_NOTICE_DISPATCH_JOB } from "@sa360/shared";

import { isGhlLeadNoticeWorkerEnabled, processGhlLeadNoticeJob } from "./ghl-lead-notice.processor.js";

function job(name: string, data: unknown = {}): Job {
  return { name, data } as Job;
}

test("the GHL lead notice worker stays off unless its own flag is exact true", async () => {
  assert.equal(isGhlLeadNoticeWorkerEnabled({}), false);
  assert.equal(isGhlLeadNoticeWorkerEnabled({ SA360_GHL_LEAD_NOTICE_ENABLED: "TRUE" }), false);
  assert.equal(isGhlLeadNoticeWorkerEnabled({ SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" }), false);
  let calls = 0;
  const skipped = await processGhlLeadNoticeJob(job(GHL_LEAD_NOTICE_DISPATCH_JOB, { receiptId: "rcpt_1" }), {
    env: { SA360_GHL_LEAD_NOTICE_ENABLED: "1", ADMIN_API_KEY: "admin", SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    postImpl: async () => {
      calls += 1;
      return { status: 200, body: "" };
    },
  });
  assert.equal(skipped.skipped, "flag_off");
  assert.equal(calls, 0);
  const sent = await processGhlLeadNoticeJob(job(GHL_LEAD_NOTICE_DISCOVER_JOB), {
    env: { SA360_GHL_LEAD_NOTICE_ENABLED: "true", ADMIN_API_KEY: "admin" },
    postImpl: async (input) => {
      calls += 1;
      assert.equal(input.url.endsWith("/admin/v1/ghl-lead-notice/internal/discover"), true);
      assert.equal(input.body, "{}");
      return { status: 200, body: "{\"ok\":true}" };
    },
  });
  assert.equal(sent.ok, true);
  assert.equal(calls, 1);
});
