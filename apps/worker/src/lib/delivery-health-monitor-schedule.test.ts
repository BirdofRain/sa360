import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Queue } from "bullmq";
import { DELIVERY_HEALTH_MONITOR_JOB, DELIVERY_HEALTH_MONITOR_QUEUE } from "@sa360/shared";

import { syncDeliveryHealthMonitorScheduleOnWorkerStart } from "./delivery-health-monitor-schedule.js";
import { redis } from "./redis.js";

after(async () => {
  await redis.quit().catch(() => undefined);
});

test("delivery health scheduling stays one job across restart and flag off", async () => {
  const queue = new Queue(DELIVERY_HEALTH_MONITOR_QUEUE, { connection: redis });
  try {
    await syncDeliveryHealthMonitorScheduleOnWorkerStart({
      SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
      SA360_DELIVERY_HEALTH_MONITOR_INTERVAL_SECONDS: "60",
    });
    await syncDeliveryHealthMonitorScheduleOnWorkerStart({
      SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
      SA360_DELIVERY_HEALTH_MONITOR_INTERVAL_SECONDS: "60",
    });
    const first = (await queue.getRepeatableJobs()).filter((job) => job.name === DELIVERY_HEALTH_MONITOR_JOB);
    assert.equal(first.length, 1);
    assert.equal(Number(first[0]?.every), 60_000);
    await syncDeliveryHealthMonitorScheduleOnWorkerStart({
      SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
      SA360_DELIVERY_HEALTH_MONITOR_INTERVAL_SECONDS: "120",
    });
    const changed = (await queue.getRepeatableJobs()).filter((job) => job.name === DELIVERY_HEALTH_MONITOR_JOB);
    assert.equal(changed.length, 1);
    assert.equal(Number(changed[0]?.every), 120_000);
    await syncDeliveryHealthMonitorScheduleOnWorkerStart({});
    assert.equal(
      (await queue.getRepeatableJobs()).filter((job) => job.name === DELIVERY_HEALTH_MONITOR_JOB).length,
      0
    );
  } finally {
    await syncDeliveryHealthMonitorScheduleOnWorkerStart({});
    const leftover = await queue.getRepeatableJobs();
    for (const job of leftover) {
      if (job.name === DELIVERY_HEALTH_MONITOR_JOB) await queue.removeRepeatableByKey(job.key);
    }
    await queue.close();
  }
});
