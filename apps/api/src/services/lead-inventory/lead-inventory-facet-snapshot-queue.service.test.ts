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

test("manual singleton rebuild is reusable after completion on local Redis", async (t) => {
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

  // A — first manual rebuild enqueues one waiting job
  const first = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(first.enqueued, true);
  assert.equal(first.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const firstJob = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.ok(firstJob, "first rebuild must create a job");
  const firstTimestamp = firstJob.timestamp;
  assert.equal(await firstJob.getState(), "waiting");
  assert.equal(await inspect.getWaitingCount(), 1, "first rebuild must leave one waiting job");

  // B — duplicate while waiting must not create backlog
  const duplicate = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(duplicate.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.equal(
    await inspect.getWaitingCount(),
    1,
    "duplicate add must not create uncontrolled backlog"
  );

  // C — complete without snapshot work; removeOnComplete:true removes singleton
  worker = new Worker(
    FACETS_SUPPLY_REBUILD_QUEUE,
    async () => ({ ok: true, source: "lifecycle-test" }),
    { connection, concurrency: 1 }
  );
  await worker.waitUntilReady();
  await firstJob.waitUntilFinished(events, 10_000);

  const afterComplete = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.equal(
    afterComplete,
    undefined,
    "completed singleton must be removed so the deterministic id is reusable"
  );
  assert.equal(await inspect.getCompletedCount(), 0);

  // Pause worker so D can observe a waiting job before it is drained.
  await worker.pause();

  // D/E — later legitimate rebuild creates a NEW waiting job (not old completed)
  const second = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(second.enqueued, true);
  assert.equal(second.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const secondJob = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
  assert.ok(secondJob, "second rebuild must create a new waiting job");
  assert.equal(await secondJob.getState(), "waiting");
  assert.notEqual(
    secondJob.timestamp,
    firstTimestamp,
    "second rebuild must not be the old completed job"
  );
  assert.equal(await inspect.getWaitingCount(), 1);

  await worker.resume();
  await secondJob.waitUntilFinished(events, 10_000);
});
