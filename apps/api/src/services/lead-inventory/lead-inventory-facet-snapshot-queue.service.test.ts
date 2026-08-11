import assert from "node:assert/strict";
import { test } from "node:test";
import { Queue, QueueEvents, Worker } from "bullmq";
import {
  FACETS_SUPPLY_REBUILD_JOB,
  FACETS_SUPPLY_REBUILD_JOB_ID,
  FACETS_SUPPLY_REBUILD_QUEUE,
} from "@sa360/shared";
import { Redis } from "ioredis";

import {
  closeFacetsSupplyRebuildQueue,
  enqueueFacetsSupplyRebuild,
} from "./lead-inventory-facet-snapshot-queue.service.js";

test("FACETS_SUPPLY_REBUILD_JOB_ID is a non-empty colon-free BullMQ custom id", () => {
  assert.ok(FACETS_SUPPLY_REBUILD_JOB_ID.length > 0);
  assert.equal(FACETS_SUPPLY_REBUILD_JOB_ID.includes(":"), false);
  assert.equal(FACETS_SUPPLY_REBUILD_JOB_ID, "facets-supply-rebuild-singleton");
});

test("manual singleton rebuild is reusable after success and failure on local Redis", async (t) => {
  const redisUrl = process.env.SA360_TEST_REDIS_URL?.trim() || "redis://127.0.0.1:6379/15";
  const probe = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  try {
    await probe.connect();
    await probe.ping();
  } catch {
    t.skip("local Redis unavailable for BullMQ singleton lifecycle test");
    probe.disconnect();
    return;
  } finally {
    probe.disconnect();
  }

  const connection = { url: redisUrl, maxRetriesPerRequest: null as null };
  const inspect = new Queue(FACETS_SUPPLY_REBUILD_QUEUE, { connection });
  const events = new QueueEvents(FACETS_SUPPLY_REBUILD_QUEUE, { connection });
  let shouldFail = false;
  let worker: Worker | null = null;

  t.after(async () => {
    if (worker) await worker.close();
    await events.close();
    await closeFacetsSupplyRebuildQueue();
    try {
      const leftover = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
      if (leftover) await leftover.remove();
    } finally {
      await inspect.close();
    }
  });

  await events.waitUntilReady();

  const existing = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  if (existing) await existing.remove();

  // 1 — first manual rebuild enqueues one waiting job
  const first = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(first.enqueued, true);
  assert.equal(first.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const firstJob = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.ok(firstJob, "first rebuild must create a job");
  const firstTimestamp = firstJob.timestamp;
  assert.equal(await firstJob.getState(), "waiting");
  assert.equal(await inspect.getWaitingCount(), 1, "first rebuild must leave one waiting job");

  // 2 — duplicate while waiting must not create backlog
  const duplicate = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(duplicate.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.equal(
    await inspect.getWaitingCount(),
    1,
    "duplicate add must not create uncontrolled backlog"
  );

  // 3 — successful completion removes singleton (removeOnComplete:true)
  worker = new Worker(
    FACETS_SUPPLY_REBUILD_QUEUE,
    async () => {
      if (shouldFail) throw new Error("lifecycle-test-intentional-fail");
      return { ok: true, source: "lifecycle-test" };
    },
    { connection, concurrency: 1 }
  );
  await worker.waitUntilReady();
  await firstJob.waitUntilFinished(events, 10_000);

  assert.equal(
    await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID),
    undefined,
    "completed singleton must be removed"
  );
  assert.equal(await inspect.getCompletedCount(), 0);

  // 4 — re-enqueue after success creates a NEW waiting job
  await worker.pause();
  const afterSuccess = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(afterSuccess.enqueued, true);
  assert.equal(afterSuccess.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const successReuseJob = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.ok(successReuseJob, "re-enqueue after success must create a waiting job");
  assert.equal(await successReuseJob.getState(), "waiting");
  assert.notEqual(successReuseJob.timestamp, firstTimestamp);
  assert.equal(await inspect.getWaitingCount(), 1);

  // Drain success-reuse job, then fail the next one.
  await worker.resume();
  await successReuseJob.waitUntilFinished(events, 10_000);
  assert.equal(await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID), undefined);

  // 5 — failed completion removes singleton (removeOnFail:true)
  await worker.pause();
  shouldFail = true;
  const failEnqueue = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(failEnqueue.enqueued, true);
  assert.equal(failEnqueue.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const failJob = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.ok(failJob, "failure path must start from a waiting job");
  const failTimestamp = failJob.timestamp;
  assert.equal(await failJob.getState(), "waiting");

  const failedSettled = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for failed event")), 10_000);
    const onFailed = ({ jobId }: { jobId: string }) => {
      if (jobId !== FACETS_SUPPLY_REBUILD_JOB_ID) return;
      clearTimeout(timer);
      events.off("failed", onFailed);
      resolve();
    };
    events.on("failed", onFailed);
  });

  await worker.resume();
  await failedSettled;

  assert.equal(
    await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID),
    undefined,
    "failed singleton must be removed so recovery can re-enqueue"
  );
  assert.equal(
    await inspect.getFailedCount(),
    0,
    "manual singleton must not remain in failed retention"
  );

  // 6 — re-enqueue after failure creates a NEW waiting job
  await worker.pause();
  shouldFail = false;
  const afterFailure = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(afterFailure.enqueued, true);
  assert.equal(afterFailure.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const recoveryJob = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.ok(recoveryJob, "re-enqueue after failure must create a waiting job");
  assert.equal(await recoveryJob.getState(), "waiting");
  assert.notEqual(recoveryJob.timestamp, failTimestamp);
  assert.equal(await inspect.getWaitingCount(), 1);

  await worker.resume();
  await recoveryJob.waitUntilFinished(events, 10_000);
});
