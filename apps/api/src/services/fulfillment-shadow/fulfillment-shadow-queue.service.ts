import { Queue } from "bullmq";
import {
  FULFILLMENT_SHADOW_JOB,
  FULFILLMENT_SHADOW_QUEUE,
} from "@sa360/shared";
import { redis } from "../../lib/redis.js";
import { markFulfillmentOutboxEnqueued } from "../../repositories/fulfillment-outbox.repository.js";
import { buildFulfillmentShadowQueueJobId } from "./fulfillment-keys.js";

let fulfillmentShadowQueue: Queue | null = null;

function getFulfillmentShadowQueue() {
  if (!fulfillmentShadowQueue) {
    fulfillmentShadowQueue = new Queue(FULFILLMENT_SHADOW_QUEUE, {
      connection: redis,
    });
  }
  return fulfillmentShadowQueue;
}

export async function enqueueFulfillmentShadowOutbox(outboxId: string) {
  const job = await getFulfillmentShadowQueue().add(
    FULFILLMENT_SHADOW_JOB,
    { outboxId },
    {
      jobId: buildFulfillmentShadowQueueJobId(outboxId),
      attempts: 4,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
  await markFulfillmentOutboxEnqueued(outboxId);
  return job;
}

export async function closeFulfillmentShadowQueue() {
  if (!fulfillmentShadowQueue) return;
  await fulfillmentShadowQueue.close();
  fulfillmentShadowQueue = null;
}
