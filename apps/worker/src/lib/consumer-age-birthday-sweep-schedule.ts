import { Queue } from "bullmq";
import {
  CONSUMER_AGE_BIRTHDAY_SWEEP_JOB,
  CONSUMER_AGE_BIRTHDAY_SWEEP_JOB_ID,
  CONSUMER_AGE_BIRTHDAY_SWEEP_QUEUE,
} from "@sa360/shared";

import { redis } from "./redis.js";
import { logger } from "./logger.js";

function parseTruthyFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseIntervalMinutes(raw: string | undefined): number {
  const fallback = 360;
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const asInt = Math.trunc(parsed);
  if (asInt < 15 || asInt > 1440) return fallback;
  return asInt;
}

/**
 * Upsert or remove the repeatable birthday sweep schedule based on env flags.
 * The flag defaults to false — startup must not activate a production cadence
 * that writes to inventory.
 */
export async function syncConsumerAgeBirthdaySweepScheduleOnWorkerStart(): Promise<void> {
  const enabled = parseTruthyFlag(process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED);
  const intervalMinutes = parseIntervalMinutes(
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_INTERVAL_MINUTES
  );

  const queue = new Queue(CONSUMER_AGE_BIRTHDAY_SWEEP_QUEUE, { connection: redis });
  try {
    const repeatables = await queue.getRepeatableJobs();
    const existing = repeatables.filter((job) => job.name === CONSUMER_AGE_BIRTHDAY_SWEEP_JOB);

    if (!enabled) {
      for (const job of existing) {
        await queue.removeRepeatableByKey(job.key);
      }
      logger.info("consumer_age_birthday_sweep.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
        intervalMinutes,
      });
      return;
    }

    await queue.add(
      CONSUMER_AGE_BIRTHDAY_SWEEP_JOB,
      { requestedBy: "schedule" },
      {
        repeat: { every: intervalMinutes * 60_000 },
        jobId: CONSUMER_AGE_BIRTHDAY_SWEEP_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );

    logger.info("consumer_age_birthday_sweep.schedule", {
      enabled: true,
      action: "upserted",
      intervalMinutes,
    });
  } finally {
    await queue.close();
  }
}
