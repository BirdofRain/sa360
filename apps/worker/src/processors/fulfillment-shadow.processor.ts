import type { Job } from "bullmq";
import { FULFILLMENT_SHADOW_JOB } from "@sa360/shared";
import { logger } from "../lib/logger.js";

export async function processFulfillmentShadowJob(job: Job<{ outboxId: string }>) {
  if (job.name !== FULFILLMENT_SHADOW_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }

  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY missing for fulfillment shadow worker");
  }

  const attemptNumber = job.attemptsMade + 1;
  const jobId = String(job.id);
  const outboxId = job.data.outboxId;

  logger.info("fulfillment_shadow.dispatch", {
    jobId,
    outboxId,
    attemptNumber,
  });

  const res = await fetch(`${apiBase}/admin/v1/fulfillment-shadow/internal/process-outbox`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": adminKey,
    },
    body: JSON.stringify({ outboxId, jobId, attemptNumber }),
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`fulfillment_shadow_failed:${res.status}:${responseText.slice(0, 200)}`);
  }

  return responseText ? JSON.parse(responseText) : { ok: true };
}
