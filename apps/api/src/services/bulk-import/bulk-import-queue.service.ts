import { Queue } from "bullmq";
import {
  BULK_IMPORT_DEFAULT_CHUNK_DELAY_MS,
  BULK_IMPORT_DEFAULT_CHUNK_SIZE,
  BULK_IMPORT_DELIVERY_JOB,
  BULK_IMPORT_DELIVERY_QUEUE,
} from "@sa360/shared";
import { redis } from "../../lib/redis.js";

export const bulkImportDeliveryQueue = new Queue(BULK_IMPORT_DELIVERY_QUEUE, {
  connection: redis,
});

export type BulkImportDeliveryJobData = {
  batchId: string;
  rowIds: string[];
  mode: "simulate" | "live_canary";
  approvedBy?: string;
  chunkIndex?: number;
};

export async function enqueueBulkImportDeliveryChunk(data: BulkImportDeliveryJobData) {
  const chunkSize = BULK_IMPORT_DEFAULT_CHUNK_SIZE;
  const chunks: string[][] = [];
  for (let i = 0; i < data.rowIds.length; i += chunkSize) {
    chunks.push(data.rowIds.slice(i, i + chunkSize));
  }

  const jobs = [];
  for (let i = 0; i < chunks.length; i++) {
    const job = await bulkImportDeliveryQueue.add(
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
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    jobs.push(job);
  }

  return jobs;
}
