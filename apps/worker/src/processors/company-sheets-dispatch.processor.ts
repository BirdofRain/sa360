import type { Job } from "bullmq";
import { COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS, COMPANY_SHEETS_DISPATCH_JOB } from "@sa360/shared";

import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

function dispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED?.trim().toLowerCase() === "true";
}

export type CompanySheetsDispatchOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
};

/**
 * Posts one drain request. A timeout throws and does not POST again.
 * The API keeps running; the next BullMQ tick is a new job.
 * Flag off and a missing admin key return without throwing so a default-off worker does not crash-loop.
 */
export async function processCompanySheetsDispatchJob(
  job: Job,
  options: CompanySheetsDispatchOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  if (job.name !== COMPANY_SHEETS_DISPATCH_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  if (!dispatchEnabled()) {
    logger.info("company_sheets_dispatch.skipped", { reason: "dispatch_disabled" });
    return { ok: true, skipped: "dispatch_disabled" };
  }
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("company_sheets_dispatch.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const timeoutMs = options.timeoutMs ?? COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS;
  const started = Date.now();
  const post = options.postImpl ?? postCompanySheetsDrain;
  let res: CompanySheetsDrainResponse;
  try {
    res = await post({
      url: `${apiBase}/admin/v1/company-sheets/internal/process-dispatch`,
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
    logger.error("company_sheets_dispatch.drain", {
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
    logger.error("company_sheets_dispatch.drain", {
      jobId: job.id,
      durationMs,
      outcome: "http_error",
      statusCode: res.status,
    });
    throw new Error("company_sheets_dispatch_http_error");
  }
  if (res.body) {
    try {
      JSON.parse(res.body);
    } catch {
      logger.error("company_sheets_dispatch.drain", {
        jobId: job.id,
        durationMs,
        outcome: "malformed_response",
        statusCode: res.status,
      });
      throw new Error("company_sheets_dispatch_malformed_response");
    }
  }
  logger.info("company_sheets_dispatch.drain", {
    jobId: job.id,
    durationMs,
    outcome: "ok",
    statusCode: res.status,
  });
  return { ok: true };
}
