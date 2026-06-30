import { Queue } from "bullmq";
import { META_DISPATCH_JOB, META_DISPATCH_QUEUE } from "@sa360/shared";
import { redis } from "../lib/redis.js";

let metaDispatchQueue: Queue | null = null;

function getMetaDispatchQueue() {
  if (!metaDispatchQueue) {
    metaDispatchQueue = new Queue(META_DISPATCH_QUEUE, {
      connection: redis,
    });
  }
  return metaDispatchQueue;
}

export async function enqueueMetaDispatch(eventUuid: string) {
  return getMetaDispatchQueue().add(
    META_DISPATCH_JOB,
    { eventUuid },
    {
      attempts: 4,
      backoff: {
        type: "exponential",
        delay: 60_000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

export async function closeMetaDispatchQueue() {
  if (!metaDispatchQueue) return;
  await metaDispatchQueue.close();
  metaDispatchQueue = null;
}