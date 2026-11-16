import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Queue } from "bullmq";
import { EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB, EXTERNAL_WEBHOOK_NOTICE_QUEUE } from "@sa360/shared";

import { syncExternalWebhookNoticeScheduleOnWorkerStart } from "./external-webhook-notice-schedule.js";
import { redis } from "./redis.js";

after(async () => {
  await redis.quit();
});

test("notice discovery scheduling stays one job and is removed when the flag is off", async () => {
  const queue = new Queue(EXTERNAL_WEBHOOK_NOTICE_QUEUE, { connection: redis });
  try {
    await syncExternalWebhookNoticeScheduleOnWorkerStart({ SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" });
    await syncExternalWebhookNoticeScheduleOnWorkerStart({
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true",
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS: "60",
    });
    const enabled = (await queue.getRepeatableJobs()).filter((job) => job.name === EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB);
    assert.equal(enabled.length, 1);
    await syncExternalWebhookNoticeScheduleOnWorkerStart({});
    const removed = (await queue.getRepeatableJobs()).filter((job) => job.name === EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB);
    assert.equal(removed.length, 0);
  } finally {
    await syncExternalWebhookNoticeScheduleOnWorkerStart({});
    await queue.close();
  }
});
