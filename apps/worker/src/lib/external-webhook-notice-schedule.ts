import { Queue } from "bullmq";
import {
  EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB,
  EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB_ID,
  EXTERNAL_WEBHOOK_NOTICE_QUEUE,
} from "@sa360/shared";

import { logger } from "./logger.js";
import { redis } from "./redis.js";

function noticeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED?.trim() === "true";
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
 * One repeatable discovery job. Flag off removes it and does not call the API.
 * A second worker start updates the same job id instead of adding another.
 */
export async function syncExternalWebhookNoticeScheduleOnWorkerStart(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const enabled = noticeEnabled(env);
  const every = intervalMs(env.SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS);
  const queue = new Queue(EXTERNAL_WEBHOOK_NOTICE_QUEUE, { connection: redis });
  try {
    const repeatables = await queue.getRepeatableJobs();
    const existing = repeatables.filter((job) => job.name === EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB);
    if (!enabled) {
      for (const job of existing) await queue.removeRepeatableByKey(job.key);
      logger.info("external_webhook_notice.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
      });
      return;
    }
    await queue.add(
      EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB,
      {},
      {
        repeat: { every },
        jobId: EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );
    logger.info("external_webhook_notice.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
