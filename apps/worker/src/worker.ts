import dotenv from "dotenv";
import { Worker } from "bullmq";
import { META_DISPATCH_QUEUE } from "@sa360/shared";
import { redis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
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
  logger.error("Job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

logger.info(`Worker started with concurrency ${concurrency}`);