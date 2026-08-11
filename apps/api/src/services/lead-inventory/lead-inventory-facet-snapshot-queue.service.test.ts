import assert from "node:assert/strict";
import { test } from "node:test";
import { Queue } from "bullmq";
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

test("BullMQ accepts the configured singleton facets rebuild jobId on local Redis", async (t) => {
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
    t.skip("local Redis unavailable for BullMQ jobId smoke test");
    probe.disconnect();
    return;
  } finally {
    probe.disconnect();
  }

  t.after(async () => {
    await closeFacetsSupplyRebuildQueue();
    const cleanup = new Queue(FACETS_SUPPLY_REBUILD_QUEUE, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
    try {
      const existing = await cleanup.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
      if (existing) await existing.remove();
    } finally {
      await cleanup.close();
    }
  });

  const first = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(first.enqueued, true);
  assert.equal(first.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  // BullMQ 5.71 accepts a second add with the same custom jobId (returns the existing
  // job without throwing). Singleton safety is the backlog size, not skipped=true.
  const second = await enqueueFacetsSupplyRebuild({ requestedBy: "admin" });
  assert.equal(second.jobId, FACETS_SUPPLY_REBUILD_JOB_ID);

  const inspect = new Queue(FACETS_SUPPLY_REBUILD_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
  });
  try {
    const waiting = await inspect.getWaitingCount();
    const delayed = await inspect.getDelayedCount();
    const active = await inspect.getActiveCount();
    assert.equal(
      waiting + delayed + active,
      1,
      "singleton jobId must not create uncontrolled duplicate backlog"
    );

    const job = await inspect.getJob(FACETS_SUPPLY_REBUILD_JOB_ID);
    assert.ok(job);
    assert.equal(job.name, FACETS_SUPPLY_REBUILD_JOB);
    assert.equal(String(job.id), FACETS_SUPPLY_REBUILD_JOB_ID);
  } finally {
    await inspect.close();
  }
});
