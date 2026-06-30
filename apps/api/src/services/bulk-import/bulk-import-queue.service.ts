import { Queue } from "bullmq";
import {
  BULK_IMPORT_DEFAULT_CHUNK_DELAY_MS,
  BULK_IMPORT_DEFAULT_CHUNK_SIZE,
  BULK_IMPORT_DELIVERY_JOB,
  BULK_IMPORT_DELIVERY_QUEUE,
} from "@sa360/shared";
import { redis } from "../../lib/redis.js";

let bulkImportDeliveryQueue: Queue | null = null;

export function getBulkImportDeliveryQueue() {
  if (!bulkImportDeliveryQueue) {
    bulkImportDeliveryQueue = new Queue(BULK_IMPORT_DELIVERY_QUEUE, {
      connection: redis,
    });
  }
  return bulkImportDeliveryQueue;
}

export type BulkImportDeliveryJobData = {
  batchId: string;
  rowIds: string[];
  mode: "simulate" | "live_canary";
  approvedBy?: string;
  chunkIndex?: number;
};

export async function enqueueBulkImportDeliveryChunk(data: BulkImportDeliveryJobData) {
  const queue = getBulkImportDeliveryQueue();
  const chunkSize = BULK_IMPORT_DEFAULT_CHUNK_SIZE;
  const chunks: string[][] = [];
  for (let i = 0; i < data.rowIds.length; i += chunkSize) {
    chunks.push(data.rowIds.slice(i, i + chunkSize));
  }

  const jobs: Array<{
    jobId: string;
    chunkIndex: number;
    rowCount: number;
    state: "waiting";
  }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const job = await queue.add(
      BULK_IMPORT_DELIVERY_JOB,
      {
        batchId: data.batchId,
        rowIds: chunks[i],
        mode: data.mode,
        approvedBy: data.approvedBy,
        chunkIndex: i,
      } satisfies BulkImportDeliveryJobData,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        delay: i * BULK_IMPORT_DEFAULT_CHUNK_DELAY_MS,
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      }
    );
    jobs.push({
      jobId: String(job.id),
      chunkIndex: i,
      rowCount: chunks[i]!.length,
      state: "waiting",
    });
  }

  return jobs;
}

export async function removeWaitingBulkImportDeliveryJobs(batchId: string) {
  const queue = getBulkImportDeliveryQueue();
  const states = ["waiting", "delayed", "paused"] as const;
  let removed = 0;
  for (const state of states) {
    const jobs = await queue.getJobs([state]);
    for (const job of jobs) {
      const data = job.data as BulkImportDeliveryJobData;
      if (data.batchId === batchId) {
        await job.remove();
        removed++;
      }
    }
  }
  return removed;
}

export async function hasActiveBulkImportDeliveryJobs(batchId: string) {
  const queue = getBulkImportDeliveryQueue();
  const active = await queue.getJobs(["active"]);
  return active.some((job) => (job.data as BulkImportDeliveryJobData).batchId === batchId);
}

export async function closeBulkImportDeliveryQueue() {
  if (!bulkImportDeliveryQueue) return;
  await bulkImportDeliveryQueue.close();
  bulkImportDeliveryQueue = null;
}
