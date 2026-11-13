import { Queue } from "bullmq";
import { EXTERNAL_WEBHOOK_DELIVERY_JOB, EXTERNAL_WEBHOOK_DELIVERY_QUEUE } from "@sa360/shared";

import { redis } from "../../lib/redis.js";
import { isExternalWebhookDeliveryEnabled } from "./external-webhook-contract.js";
import {
  listRecordedExternalWebhookAttemptIds,
  promoteStaleExternalWebhookSends,
} from "./external-webhook-send.js";

let deliveryQueue: Queue | null = null;

function getQueue(): Queue {
  if (!deliveryQueue) {
    deliveryQueue = new Queue(EXTERNAL_WEBHOOK_DELIVERY_QUEUE, { connection: redis });
  }
  return deliveryQueue;
}

export function wasExternalWebhookQueueOpened(): boolean {
  return deliveryQueue !== null;
}

export async function closeExternalWebhookQueue(): Promise<void> {
  if (!deliveryQueue) return;
  await deliveryQueue.close();
  deliveryQueue = null;
}

/** One job per attempt. A second add with the same id does not create a second POST. */
export async function enqueueExternalWebhookAttempt(attemptId: string): Promise<void> {
  await getQueue().add(
    EXTERNAL_WEBHOOK_DELIVERY_JOB,
    { attemptId },
    {
      jobId: attemptId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 20,
    }
  );
}

/**
 * Promotes crashed in-flight claims to uncertain, then re-enqueues recorded
 * attempts when the flag is exact true. Flag off does not enqueue and does
 * not open a customer socket. Stale claims are still closed.
 */
export async function recoverExternalWebhookDeliveries(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ promoted: number; enqueued: number }> {
  const { promoted } = await promoteStaleExternalWebhookSends();
  if (!isExternalWebhookDeliveryEnabled(env)) return { promoted, enqueued: 0 };
  const ids = await listRecordedExternalWebhookAttemptIds();
  let enqueued = 0;
  for (const attemptId of ids) {
    try {
      await enqueueExternalWebhookAttempt(attemptId);
      enqueued += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/already exists|Job is already/i.test(message)) continue;
      throw err;
    }
  }
  return { promoted, enqueued };
}
