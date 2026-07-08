import dotenv from "dotenv";
import { Worker } from "bullmq";
import { BULK_IMPORT_DELIVERY_QUEUE, FULFILLMENT_SHADOW_QUEUE, META_DISPATCH_QUEUE } from "@sa360/shared";
import { redis } from "./lib/redis.js";
import { flushLogger, logger } from "./lib/logger.js";
import { logM1AEvent } from "./lib/m1a-event-log.js";
import { processMetaDispatch } from "./processors/meta-dispatch.processor.js";
import { processBulkImportDelivery } from "./processors/bulk-import-delivery.processor.js";
import { processFulfillmentShadowJob } from "./processors/fulfillment-shadow.processor.js";
import { logBulkImportWorkerStartupDiagnostics } from "./lib/bulk-import-worker-diagnostics.js";

dotenv.config();

const metaConcurrency = Number(process.env.META_DISPATCH_CONCURRENCY || 5);
const bulkImportConcurrency = Number(process.env.BULK_IMPORT_DELIVERY_CONCURRENCY || 2);
const fulfillmentShadowConcurrency = Number(process.env.FULFILLMENT_SHADOW_CONCURRENCY || 2);

const metaWorker = new Worker(
  META_DISPATCH_QUEUE,
  (job) => processMetaDispatch(job),
  {
    connection: redis,
    concurrency: metaConcurrency,
  }
);

const bulkImportWorker = new Worker(
  BULK_IMPORT_DELIVERY_QUEUE,
  processBulkImportDelivery,
  {
    connection: redis,
    concurrency: bulkImportConcurrency,
  }
);

const fulfillmentShadowWorker = new Worker(
  FULFILLMENT_SHADOW_QUEUE,
  (job) => processFulfillmentShadowJob(job),
  {
    connection: redis,
    concurrency: fulfillmentShadowConcurrency,
  }
);

const worker = metaWorker;

worker.on("completed", (job) => {
  logger.info("Job completed", { jobId: job.id, queue: job.queueName });
});

bulkImportWorker.on("completed", (job) => {
  logger.info("Bulk import job completed", { jobId: job.id });
});

fulfillmentShadowWorker.on("completed", (job) => {
  logger.info("Fulfillment shadow job completed", { jobId: job.id });
});

fulfillmentShadowWorker.on("failed", (job, err) => {
  logger.error("Fulfillment shadow job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

worker.on("failed", (job, err) => {
  const job_id = String(job?.id ?? "unknown");
  const request_id = `worker:${job_id}`;
  const eventUuid =
    job?.data && typeof job.data === "object" && "eventUuid" in job.data
      ? String((job.data as { eventUuid?: string }).eventUuid ?? "")
      : undefined;

  logM1AEvent("worker.job.failed", null, {
    job_id,
    request_id,
    status: "failed",
    event_uuid: eventUuid,
    error_message: err.message,
    log_level: "error",
  });

  logger.error("Job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

bulkImportWorker.on("failed", (job, err) => {
  logger.error("Bulk import job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

logger.info(
  `Worker started meta ${metaConcurrency}, bulk import ${bulkImportConcurrency}, fulfillment shadow ${fulfillmentShadowConcurrency}`
);
logBulkImportWorkerStartupDiagnostics();

async function shutdown(signal: string) {
  logger.info("Worker shutting down", { signal });
  await metaWorker.close();
  await bulkImportWorker.close();
  await fulfillmentShadowWorker.close();
  await flushLogger();
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void shutdown(sig);
  });
}