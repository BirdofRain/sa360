import { Queue } from "bullmq";
import {
  EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB,
  EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB_ID,
  EXTERNAL_WEBHOOK_DELIVERY_QUEUE,
} from "@sa360/shared";

import { logger } from "./logger.js";
import { redis } from "./redis.js";

function deliveryEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED?.trim() === "true";
}

function intervalMs(raw: string | undefined): number {
  const fallback = 60_000;
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const seconds = Math.trunc(parsed);
  if (seconds < 15 || seconds > 3600) return fallback;
  return seconds * 1000;
}

/** Repeatable recovery. Flag off removes the job and does not call the API. */
export async function syncExternalWebhookDeliveryScheduleOnWorkerStart(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const enabled = deliveryEnabled(env);
  const every = intervalMs(env.SA360_EXTERNAL_WEBHOOK_RECOVER_INTERVAL_SECONDS);
  const queue = new Queue(EXTERNAL_WEBHOOK_DELIVERY_QUEUE, { connection: redis });
  try {
    const repeatables = await queue.getRepeatableJobs();
    const existing = repeatables.filter((job) => job.name === EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB);
    if (!enabled) {
      for (const job of existing) await queue.removeRepeatableByKey(job.key);
      logger.info("external_webhook_delivery.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
      });
      return;
    }
    await queue.add(
      EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB,
      {},
      {
        repeat: { every },
        jobId: EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );
    logger.info("external_webhook_delivery.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
