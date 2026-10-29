import { Queue } from "bullmq";
import {
  GHL_ASSOCIATION_DISPATCH_JOB,
  GHL_ASSOCIATION_DISPATCH_JOB_ID,
  GHL_ASSOCIATION_DISPATCH_QUEUE,
} from "@sa360/shared";

import { redis } from "./redis.js";
import { logger } from "./logger.js";

function serviceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_GHL_ONGOING_DELIVERY_ENABLED?.trim().toLowerCase() === "true";
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

/** Repeatable recovery. Flag off removes the job and does not call GHL. */
export async function syncGhlAssociationDispatchScheduleOnWorkerStart(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const enabled = serviceEnabled(env);
  const every = intervalMs(env.SA360_GHL_ASSOCIATION_DISPATCH_INTERVAL_SECONDS);
  const queue = new Queue(GHL_ASSOCIATION_DISPATCH_QUEUE, { connection: redis });
  try {
    const repeatables = await queue.getRepeatableJobs();
    const existing = repeatables.filter((job) => job.name === GHL_ASSOCIATION_DISPATCH_JOB);
    if (!enabled) {
      for (const job of existing) await queue.removeRepeatableByKey(job.key);
      logger.info("ghl_association_dispatch.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
      });
      return;
    }
    await queue.add(
      GHL_ASSOCIATION_DISPATCH_JOB,
      {},
      {
        repeat: { every },
        jobId: GHL_ASSOCIATION_DISPATCH_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );
    logger.info("ghl_association_dispatch.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
