import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { META_LEADGEN_FETCH_JOB } from "@sa360/shared";
import { logger } from "../lib/logger.js";

export type MetaLeadgenFetchJobData = {
  leadgenId: string;
  sourceLeadEventId: string;
  fixture?: boolean;
};

/**
 * Thin worker: Graph tokens, advisory-lock serialization, normalize, and shadow
 * routing stay in @sa360/api. This processor must never use META_DISPATCH_QUEUE.
 */
export async function processMetaLeadgenFetchJob(job: Job<MetaLeadgenFetchJobData>) {
  if (job.name !== META_LEADGEN_FETCH_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }

  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY missing for meta-leadgen-fetch worker");
  }

  const attemptNumber = job.attemptsMade + 1;
  const jobId = String(job.id);
  const { leadgenId, sourceLeadEventId, fixture } = job.data;

  logger.info("meta_leadgen_fetch.dispatch", {
    jobId,
    leadgenId,
    sourceLeadEventId,
    attemptNumber,
    fixture: Boolean(fixture),
  });

  const res = await fetch(`${apiBase}/admin/v1/meta-leadgen/internal/process-fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": adminKey,
    },
    body: JSON.stringify({
      leadgenId,
      sourceLeadEventId,
      fixture: Boolean(fixture),
      jobId,
      attemptNumber,
    }),
  });

  const responseText = await res.text();
  if (res.status === 422) {
    throw new UnrecoverableError(
      `meta_leadgen_fetch_terminal:${res.status}:${responseText.slice(0, 200)}`
    );
  }
  if (!res.ok) {
    throw new Error(`meta_leadgen_fetch_failed:${res.status}:${responseText.slice(0, 200)}`);
  }

  return responseText ? JSON.parse(responseText) : { ok: true };
}
