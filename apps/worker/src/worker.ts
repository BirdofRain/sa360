import dotenv from "dotenv";
import { Worker } from "bullmq";
import { META_DISPATCH_QUEUE } from "@sa360/shared";
import { redis } from "./lib/redis.js";
import { flushLogger, logger } from "./lib/logger.js";
import { logM1AEvent } from "./lib/m1a-event-log.js";
import { processMetaDispatch } from "./processors/meta-dispatch.processor.js";

dotenv.config();

const concurrency = Number(process.env.META_DISPATCH_CONCURRENCY || 5);

const worker = new Worker(
  META_DISPATCH_QUEUE,
  processMetaDispatch,
  {
    connection: redis,
    concurrency,
  }
);

worker.on("completed", (job) => {
  logger.info("Job completed", { jobId: job.id });
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

logger.info(`Worker started with concurrency ${concurrency}`);

async function shutdown(signal: string) {
  logger.info("Worker shutting down", { signal });
  await worker.close();
  await flushLogger();
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void shutdown(sig);
  });
}