import { Queue } from "bullmq";
import {
  ONGOING_GHL_DISPATCH_JOB,
  ONGOING_GHL_DISPATCH_JOB_ID,
  ONGOING_GHL_DISPATCH_QUEUE,
} from "@sa360/shared";

import { redis } from "./redis.js";
import { logger } from "./logger.js";

function intervalMs(raw: string | undefined): number {
  const fallback = 60_000;
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const seconds = Math.trunc(parsed);
  if (seconds < 15 || seconds > 3600) return fallback;
  return seconds * 1000;
}

/** Repeatable drain. Attempts stay at 1. The API decides whether a row may be sent. */
export async function syncOngoingGhlDispatchScheduleOnWorkerStart(): Promise<void> {
  const every = intervalMs(process.env.SA360_ONGOING_GHL_DISPATCH_INTERVAL_SECONDS);
  const queue = new Queue(ONGOING_GHL_DISPATCH_QUEUE, { connection: redis });
  try {
    await queue.add(
      ONGOING_GHL_DISPATCH_JOB,
      {},
      {
        repeat: { every },
        jobId: ONGOING_GHL_DISPATCH_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );
    logger.info("ongoing_ghl_dispatch.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
