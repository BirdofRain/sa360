import { Queue } from "bullmq";
import {
  DELIVERY_HEALTH_MONITOR_JOB,
  DELIVERY_HEALTH_MONITOR_JOB_ID,
  DELIVERY_HEALTH_MONITOR_QUEUE,
} from "@sa360/shared";

import { logger } from "./logger.js";
import { redis } from "./redis.js";

function monitorEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SA360_DELIVERY_HEALTH_MONITOR_ENABLED?.trim() === "true";
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

/**
 * One repeatable scan. Flag off removes it and does not call the API.
 * A second worker start updates the same job id instead of adding another.
 */
export async function syncDeliveryHealthMonitorScheduleOnWorkerStart(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const enabled = monitorEnabled(env);
  const every = intervalMs(env.SA360_DELIVERY_HEALTH_MONITOR_INTERVAL_SECONDS);
  const queue = new Queue(DELIVERY_HEALTH_MONITOR_QUEUE, { connection: redis });
  try {
    const discover = () =>
      queue.getRepeatableJobs().then((jobs) => jobs.filter((job) => job.name === DELIVERY_HEALTH_MONITOR_JOB));
    const existing = await discover();
    if (!enabled) {
      for (const job of existing) await queue.removeRepeatableByKey(job.key);
      logger.info("delivery_health.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
      });
      return;
    }
    for (const job of existing) {
      const currentEvery = job.every == null ? null : Number(job.every);
      if (currentEvery !== every || job.id !== DELIVERY_HEALTH_MONITOR_JOB_ID) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    const remaining = await discover();
    if (remaining.length === 0) {
      await queue.add(
        DELIVERY_HEALTH_MONITOR_JOB,
        {},
        {
          repeat: { every },
          jobId: DELIVERY_HEALTH_MONITOR_JOB_ID,
          removeOnComplete: 20,
          removeOnFail: 40,
          attempts: 1,
        }
      );
    } else {
      for (const extra of remaining.slice(1)) await queue.removeRepeatableByKey(extra.key);
    }
    logger.info("delivery_health.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
