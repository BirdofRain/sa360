import { Queue } from "bullmq";
import { COMPANY_SHEETS_DISPATCH_JOB, COMPANY_SHEETS_DISPATCH_JOB_ID, COMPANY_SHEETS_DISPATCH_QUEUE } from "@sa360/shared";

import { redis } from "./redis.js";
import { logger } from "./logger.js";

function dispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED?.trim().toLowerCase() === "true";
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

/** Repeatable drain. Default off. Disabling removes the repeatable job and does not call Google. */
export async function syncCompanySheetsDispatchScheduleOnWorkerStart(): Promise<void> {
  const enabled = dispatchEnabled();
  const every = intervalMs(process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_INTERVAL_SECONDS);
  const queue = new Queue(COMPANY_SHEETS_DISPATCH_QUEUE, { connection: redis });
  try {
    const repeatables = await queue.getRepeatableJobs();
    const existing = repeatables.filter((job) => job.name === COMPANY_SHEETS_DISPATCH_JOB);
    if (!enabled) {
      for (const job of existing) await queue.removeRepeatableByKey(job.key);
      logger.info("company_sheets_dispatch.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
      });
      return;
    }
    await queue.add(
      COMPANY_SHEETS_DISPATCH_JOB,
      {},
      {
        repeat: { every },
        jobId: COMPANY_SHEETS_DISPATCH_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );
    logger.info("company_sheets_dispatch.schedule", { enabled: true, action: "upserted", every });
  } finally {
    await queue.close();
  }
}
