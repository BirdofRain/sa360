import type { Job } from "bullmq";
import { ONGOING_GHL_DISPATCH_HTTP_TIMEOUT_MS, ONGOING_GHL_DISPATCH_JOB } from "@sa360/shared";

import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

export type OngoingGhlDispatchOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
};

/**
 * Posts one drain request. A timeout throws and does not POST again.
 * A missing admin key returns without throwing so the worker does not crash-loop.
 * There is no default-off flag: the API leaves intents pending until runtime is live.
 */
export async function processOngoingGhlDispatchJob(
  job: Job,
  options: OngoingGhlDispatchOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  if (job.name !== ONGOING_GHL_DISPATCH_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("ongoing_ghl_dispatch.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const timeoutMs = options.timeoutMs ?? ONGOING_GHL_DISPATCH_HTTP_TIMEOUT_MS;
  const started = Date.now();
  const post = options.postImpl ?? postCompanySheetsDrain;
  let res: CompanySheetsDrainResponse;
  try {
    res = await post({
      url: `${apiBase}/admin/v1/ghl-ongoing-delivery/internal/process-dispatch`,
      headers: {
        "content-type": "application/json",
        "x-sa360-admin-key": adminKey,
      },
      body: "{}",
      timeoutMs,
    });
  } catch (err) {
    const durationMs = Date.now() - started;
    const timedOut =
      err instanceof CompanySheetsDrainTimeoutError ||
      (err instanceof Error && err.name === "CompanySheetsDrainTimeoutError");
    logger.error("ongoing_ghl_dispatch.drain", {
      jobId: job.id,
      durationMs,
      outcome: timedOut ? "timeout" : "network_error",
      timeoutMs,
    });
    if (timedOut) throw new CompanySheetsDrainTimeoutError();
    throw err;
  }
  const durationMs = Date.now() - started;
  if (res.status < 200 || res.status >= 300) {
    logger.error("ongoing_ghl_dispatch.drain", {
      jobId: job.id,
      durationMs,
      outcome: "http_error",
      statusCode: res.status,
    });
    throw new Error("ongoing_ghl_dispatch_http_error");
  }
  logger.info("ongoing_ghl_dispatch.drain", {
    jobId: job.id,
    durationMs,
    outcome: "ok",
    statusCode: res.status,
  });
  return { ok: true };
}
