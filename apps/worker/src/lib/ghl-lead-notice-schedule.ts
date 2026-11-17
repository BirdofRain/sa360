import { Queue } from "bullmq";
import {
  GHL_LEAD_NOTICE_DISCOVER_JOB,
  GHL_LEAD_NOTICE_DISCOVER_JOB_ID,
  GHL_LEAD_NOTICE_QUEUE,
} from "@sa360/shared";

import { logger } from "./logger.js";
import { redis } from "./redis.js";

function noticeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SA360_GHL_LEAD_NOTICE_ENABLED?.trim() === "true";
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
export async function syncGhlLeadNoticeScheduleOnWorkerStart(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const enabled = noticeEnabled(env);
  const every = intervalMs(env.SA360_GHL_LEAD_NOTICE_DISCOVER_INTERVAL_SECONDS);
  const queue = new Queue(GHL_LEAD_NOTICE_QUEUE, { connection: redis });
  try {
    const discover = () =>
      queue.getRepeatableJobs().then((jobs) => jobs.filter((job) => job.name === GHL_LEAD_NOTICE_DISCOVER_JOB));
    const existing = await discover();
    if (!enabled) {
      for (const job of existing) await queue.removeRepeatableByKey(job.key);
      logger.info("ghl_lead_notice.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
      });
      return;
    }
    for (const job of existing) {
      const currentEvery = job.every == null ? null : Number(job.every);
      if (currentEvery !== every || job.id !== GHL_LEAD_NOTICE_DISCOVER_JOB_ID) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    const remaining = await discover();
    if (remaining.length === 0) {
      await queue.add(
        GHL_LEAD_NOTICE_DISCOVER_JOB,
        {},
        {
          repeat: { every },
          jobId: GHL_LEAD_NOTICE_DISCOVER_JOB_ID,
          removeOnComplete: 20,
          removeOnFail: 40,
          attempts: 1,
        }
      );
    } else {
      for (const extra of remaining.slice(1)) await queue.removeRepeatableByKey(extra.key);
    }
    logger.info("ghl_lead_notice.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
