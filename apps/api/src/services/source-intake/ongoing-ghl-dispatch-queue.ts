import { Queue } from "bullmq";
import {
  ONGOING_GHL_DISPATCH_JOB,
  ONGOING_GHL_DISPATCH_JOB_ID,
  ONGOING_GHL_DISPATCH_QUEUE,
} from "@sa360/shared";

import { logger } from "../../lib/logger.js";
import { redis } from "../../lib/redis.js";

let queue: Queue | null = null;

function dispatchQueue(): Queue {
  if (!queue) {
    queue = new Queue(ONGOING_GHL_DISPATCH_QUEUE, { connection: redis });
  }
  return queue;
}

/**
 * Best-effort nudge so the first send is prompt. A failure leaves the intent
 * pending for the repeatable worker. This does not call GHL.
 */
export async function enqueueOngoingGhlDispatch(): Promise<void> {
  try {
    await dispatchQueue().add(
      ONGOING_GHL_DISPATCH_JOB,
      {},
      {
        jobId: `${ONGOING_GHL_DISPATCH_JOB_ID}-nudge`,
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 1,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists|already waiting|duplicate/i.test(message)) return;
    logger.warn("ongoing_ghl.enqueue_failed", { error: message });
  }
}
