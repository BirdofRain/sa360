import { Queue } from "bullmq";
import {
  FACETS_SUPPLY_REBUILD_JOB,
  FACETS_SUPPLY_REBUILD_JOB_ID,
  FACETS_SUPPLY_REBUILD_QUEUE,
  LEAD_INVENTORY_AGE_BAND_VERSION,
} from "@sa360/shared";

import {
  getLeadInventoryFacetSnapshotRebuildIntervalMinutes,
  isLeadInventoryFacetSnapshotRebuildEnabled,
} from "../../lib/lead-inventory-facet-snapshot-env.js";
import { redis } from "../../lib/redis.js";

let facetsSupplyRebuildQueue: Queue | null = null;
let facetsSupplyRebuildQueueOpened = false;

function getFacetsSupplyRebuildQueue(): Queue {
  if (!facetsSupplyRebuildQueue) {
    facetsSupplyRebuildQueue = new Queue(FACETS_SUPPLY_REBUILD_QUEUE, {
      connection: redis,
    });
    facetsSupplyRebuildQueueOpened = true;
  }
  return facetsSupplyRebuildQueue;
}

export function wasFacetsSupplyRebuildQueueOpened(): boolean {
  return facetsSupplyRebuildQueueOpened;
}

export async function closeFacetsSupplyRebuildQueue(): Promise<void> {
  if (!facetsSupplyRebuildQueue) return;
  await facetsSupplyRebuildQueue.close();
  facetsSupplyRebuildQueue = null;
}

export type FacetsSupplyRebuildJobData = {
  ageBandVersion: string;
  requestedBy: "schedule" | "admin" | "worker";
};

/**
 * Enqueue a singleton rebuild job. Deterministic jobId prevents unbounded backlog.
 * Returns skipped=true when an identical job is already waiting/active.
 */
export async function enqueueFacetsSupplyRebuild(opts?: {
  ageBandVersion?: string;
  requestedBy?: FacetsSupplyRebuildJobData["requestedBy"];
}): Promise<{ enqueued: boolean; jobId: string; skipped?: boolean }> {
  const ageBandVersion = opts?.ageBandVersion ?? LEAD_INVENTORY_AGE_BAND_VERSION;
  const requestedBy = opts?.requestedBy ?? "admin";
  const queue = getFacetsSupplyRebuildQueue();

  try {
    const job = await queue.add(
      FACETS_SUPPLY_REBUILD_JOB,
      { ageBandVersion, requestedBy } satisfies FacetsSupplyRebuildJobData,
      {
        jobId: FACETS_SUPPLY_REBUILD_JOB_ID,
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 1,
      }
    );
    return { enqueued: true, jobId: String(job.id) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists|JobId/i.test(message)) {
      return { enqueued: false, jobId: FACETS_SUPPLY_REBUILD_JOB_ID, skipped: true };
    }
    throw err;
  }
}

/**
 * Register (or refresh) the repeatable rebuild schedule when the rebuild flag is enabled.
 * Default: disabled — deploying this code does not activate production rebuilds.
 */
export async function syncFacetsSupplyRebuildSchedule(): Promise<{
  enabled: boolean;
  intervalMinutes: number;
  action: "upserted" | "removed" | "noop";
}> {
  const enabled = isLeadInventoryFacetSnapshotRebuildEnabled();
  const intervalMinutes = getLeadInventoryFacetSnapshotRebuildIntervalMinutes();
  const queue = getFacetsSupplyRebuildQueue();
  const repeatables = await queue.getRepeatableJobs();
  const existing = repeatables.filter((job) => job.name === FACETS_SUPPLY_REBUILD_JOB);

  if (!enabled) {
    for (const job of existing) {
      await queue.removeRepeatableByKey(job.key);
    }
    return {
      enabled: false,
      intervalMinutes,
      action: existing.length > 0 ? "removed" : "noop",
    };
  }

  await queue.add(
    FACETS_SUPPLY_REBUILD_JOB,
    {
      ageBandVersion: LEAD_INVENTORY_AGE_BAND_VERSION,
      requestedBy: "schedule",
    } satisfies FacetsSupplyRebuildJobData,
    {
      repeat: { every: intervalMinutes * 60_000 },
      jobId: FACETS_SUPPLY_REBUILD_JOB_ID,
      removeOnComplete: 20,
      removeOnFail: 40,
      attempts: 1,
    }
  );

  return { enabled: true, intervalMinutes, action: "upserted" };
}
