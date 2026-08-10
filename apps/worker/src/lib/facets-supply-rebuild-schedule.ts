import { Queue } from "bullmq";
import {
  FACETS_SUPPLY_REBUILD_JOB,
  FACETS_SUPPLY_REBUILD_JOB_ID,
  FACETS_SUPPLY_REBUILD_QUEUE,
  LEAD_INVENTORY_AGE_BAND_VERSION,
} from "@sa360/shared";

import { redis } from "./redis.js";
import { logger } from "./logger.js";

function parseTruthyFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseIntervalMinutes(raw: string | undefined): number {
  const fallback = 15;
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const asInt = Math.trunc(parsed);
  if (asInt < 5 || asInt > 1440) return fallback;
  return asInt;
}

/**
 * Upsert or remove the repeatable rebuild schedule based on env flags.
 * Default rebuild flag is false — startup must not activate production cadence.
 */
export async function syncFacetsSupplyRebuildScheduleOnWorkerStart(): Promise<void> {
  const enabled = parseTruthyFlag(process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_ENABLED);
  const intervalMinutes = parseIntervalMinutes(
    process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_INTERVAL_MINUTES
  );

  const queue = new Queue(FACETS_SUPPLY_REBUILD_QUEUE, { connection: redis });
  try {
    const repeatables = await queue.getRepeatableJobs();
    const existing = repeatables.filter((job) => job.name === FACETS_SUPPLY_REBUILD_JOB);

    if (!enabled) {
      for (const job of existing) {
        await queue.removeRepeatableByKey(job.key);
      }
      logger.info("facets_supply_rebuild.schedule", {
        enabled: false,
        action: existing.length > 0 ? "removed" : "noop",
        intervalMinutes,
      });
      return;
    }

    await queue.add(
      FACETS_SUPPLY_REBUILD_JOB,
      {
        ageBandVersion: LEAD_INVENTORY_AGE_BAND_VERSION,
        requestedBy: "schedule",
      },
      {
        repeat: { every: intervalMinutes * 60_000 },
        jobId: FACETS_SUPPLY_REBUILD_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );

    logger.info("facets_supply_rebuild.schedule", {
      enabled: true,
      action: "upserted",
      intervalMinutes,
    });
  } finally {
    await queue.close();
  }
}
