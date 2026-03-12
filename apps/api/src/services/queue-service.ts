import { Queue } from "bullmq";
import { META_DISPATCH_JOB, META_DISPATCH_QUEUE } from "@sa360/shared";
import { redis } from "../lib/redis.js";

export const metaDispatchQueue = new Queue(META_DISPATCH_QUEUE, {
  connection: redis,
});

export async function enqueueMetaDispatch(eventUuid: string) {
  return metaDispatchQueue.add(
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