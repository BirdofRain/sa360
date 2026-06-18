import type { Job } from "bullmq";
import { BULK_IMPORT_DELIVERY_JOB } from "@sa360/shared";
import { logger } from "../lib/logger.js";
import type { BulkImportDeliveryJobData } from "./bulk-import-delivery.types.js";

export async function processBulkImportDelivery(job: Job<BulkImportDeliveryJobData>) {
  if (job.name !== BULK_IMPORT_DELIVERY_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }

  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY missing for bulk import worker");
  }

  const attemptNumber = job.attemptsMade + 1;
  const jobId = String(job.id);

  logger.info("bulk_import.delivery.chunk.dispatch", {
    jobId,
    batchId: job.data.batchId,
    rowCount: job.data.rowIds.length,
    chunkIndex: job.data.chunkIndex,
    attemptNumber,
  });

  const res = await fetch(`${apiBase}/admin/v1/bulk-imports/internal/process-chunk`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": adminKey,
    },
    body: JSON.stringify({
      ...job.data,
      jobId,
      attemptNumber,
    }),
  });

  const responseText = await res.text();
  let payload: {
    delivered?: number;
    failed?: number;
    batchStatus?: string;
  } | null = null;
  try {
    payload = JSON.parse(responseText) as {
      delivered?: number;
      failed?: number;
      batchStatus?: string;
    };
  } catch {
    payload = null;
  }

  logger.info("bulk_import.delivery.chunk.result", {
    jobId,
    batchId: job.data.batchId,
    rowCount: job.data.rowIds.length,
    chunkIndex: job.data.chunkIndex,
    attemptNumber,
    apiResponseStatus: res.status,
    delivered: payload?.delivered ?? null,
    failed: payload?.failed ?? null,
    batchStatus: payload?.batchStatus ?? null,
  });

  if (!res.ok) {
    throw new Error(`bulk_import_chunk_failed:${res.status}:${responseText.slice(0, 200)}`);
  }

  return payload ?? { ok: true };
}
