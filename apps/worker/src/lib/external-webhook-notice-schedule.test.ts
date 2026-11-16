import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Queue } from "bullmq";
import {
  EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB,
  EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB,
  EXTERNAL_WEBHOOK_NOTICE_QUEUE,
} from "@sa360/shared";

import { syncExternalWebhookNoticeScheduleOnWorkerStart } from "./external-webhook-notice-schedule.js";
import { redis } from "./redis.js";

after(async () => {
  await redis.quit();
});

function discoverJobs(jobs: Array<{ name: string; every?: string | number | null; id?: string | null; key: string }>) {
  return jobs.filter((job) => job.name === EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB);
}

test("notice discovery scheduling stays one job across restart, interval change, and flag off", async () => {
  const queue = new Queue(EXTERNAL_WEBHOOK_NOTICE_QUEUE, { connection: redis });
  try {
    await queue.add(
      EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB,
      { receiptId: "schedule-decoy" },
      { repeat: { every: 120_000 }, jobId: "notice-schedule-decoy" }
    );
    await syncExternalWebhookNoticeScheduleOnWorkerStart({
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true",
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS: "60",
    });
    await syncExternalWebhookNoticeScheduleOnWorkerStart({
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true",
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS: "60",
    });
    const first = discoverJobs(await queue.getRepeatableJobs());
    assert.equal(first.length, 1);
    assert.equal(Number(first[0]?.every), 60_000);
    await syncExternalWebhookNoticeScheduleOnWorkerStart({
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true",
      SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS: "120",
    });
    const changed = discoverJobs(await queue.getRepeatableJobs());
    assert.equal(changed.length, 1);
    assert.equal(Number(changed[0]?.every), 120_000);
    const decoy = (await queue.getRepeatableJobs()).filter((job) => job.name === EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB);
    assert.equal(decoy.length, 1);
    await syncExternalWebhookNoticeScheduleOnWorkerStart({});
    assert.equal(discoverJobs(await queue.getRepeatableJobs()).length, 0);
    assert.equal(
      (await queue.getRepeatableJobs()).filter((job) => job.name === EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB).length,
      1
    );
  } finally {
    await syncExternalWebhookNoticeScheduleOnWorkerStart({});
    const leftover = await queue.getRepeatableJobs();
    for (const job of leftover) {
      if (job.name === EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB || job.name === EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    await queue.close();
  }
});
