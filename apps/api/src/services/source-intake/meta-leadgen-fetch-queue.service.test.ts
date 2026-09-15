import test from "node:test";
import assert from "node:assert/strict";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { META_LEADGEN_FETCH_QUEUE } from "@sa360/shared";
import {
  buildMetaLeadgenFetchJobId,
  closeMetaLeadgenFetchQueue,
  enqueueMetaLeadgenFetch,
  isDuplicateMetaLeadgenJobIdError,
} from "./meta-leadgen-fetch-queue.service.js";

test("buildMetaLeadgenFetchJobId is deterministic and colon-free", () => {
  const a = buildMetaLeadgenFetchJobId("1234567890");
  const b = buildMetaLeadgenFetchJobId(" 1234567890 ");
  assert.equal(a, "meta-leadgen-fetch-1234567890");
  assert.equal(a, b);
  assert.equal(a.includes(":"), false);
});

test("buildMetaLeadgenFetchJobId sanitizes unsafe characters", () => {
  const id = buildMetaLeadgenFetchJobId("lead/gen:id?");
  assert.equal(id, "meta-leadgen-fetch-lead_gen_id_");
  assert.equal(id.includes(":"), false);
  assert.equal(id.includes("/"), false);
});

test("buildMetaLeadgenFetchJobId rejects empty leadgen ids", () => {
  assert.throws(() => buildMetaLeadgenFetchJobId("   "), /leadgen_id_required/);
});

test("isDuplicateMetaLeadgenJobIdError matches old BullMQ throw, not generic JobId text", () => {
  assert.equal(
    isDuplicateMetaLeadgenJobIdError(new Error("Job with id meta-leadgen-fetch-1 already exists")),
    true
  );
  assert.equal(
    isDuplicateMetaLeadgenJobIdError(new Error("JobId cannot be '0' or start with 0:")),
    false
  );
  assert.equal(isDuplicateMetaLeadgenJobIdError(new Error("Redis connection refused")), false);
  assert.equal(
    isDuplicateMetaLeadgenJobIdError({ name: "JobIdAlreadyExists", message: "custom" }),
    true
  );
});

test("duplicate custom jobId while waiting is skipped and does not throw on local Redis", async (t) => {
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
    t.skip("local Redis unavailable for meta-leadgen-fetch jobId lifecycle test");
    probe.disconnect();
    return;
  } finally {
    probe.disconnect();
  }

  const leadgenId = `lead_q_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const jobId = buildMetaLeadgenFetchJobId(leadgenId);
  const connection = { url: redisUrl, maxRetriesPerRequest: null as null };
  const inspect = new Queue(META_LEADGEN_FETCH_QUEUE, { connection });

  t.after(async () => {
    await closeMetaLeadgenFetchQueue();
    try {
      const leftover = await inspect.getJob(jobId);
      if (leftover) await leftover.remove();
    } finally {
      await inspect.close();
    }
  });

  const existing = await inspect.getJob(jobId);
  if (existing) await existing.remove();

  const first = await enqueueMetaLeadgenFetch({
    leadgenId,
    sourceLeadEventId: "evt_q_1",
  });
  assert.equal(first.enqueued, true);
  assert.equal(first.jobId, jobId);

  const waiting = await inspect.getJob(jobId);
  assert.ok(waiting);
  assert.equal(await waiting.getState(), "waiting");

  const duplicate = await enqueueMetaLeadgenFetch({
    leadgenId,
    sourceLeadEventId: "evt_q_1",
  });
  assert.equal(duplicate.enqueued, false);
  assert.equal(duplicate.skipped, true);
  const stillWaiting = await inspect.getJob(jobId);
  assert.ok(stillWaiting);
  assert.equal(await stillWaiting.getState(), "waiting");
  assert.equal(stillWaiting.timestamp, waiting.timestamp);

  const addAgain = await inspect.add("fetch-meta-lead", { leadgenId }, { jobId });
  assert.equal(addAgain.id, jobId);
  const afterSilentAdd = await inspect.getJob(jobId);
  assert.ok(afterSilentAdd);
  assert.equal(afterSilentAdd.timestamp, waiting.timestamp);
  assert.equal(await afterSilentAdd.getState(), "waiting");
});
