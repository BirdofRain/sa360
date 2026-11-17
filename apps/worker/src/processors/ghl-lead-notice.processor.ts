import type { Job } from "bullmq";
import {
  COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
  GHL_LEAD_NOTICE_DISCOVER_JOB,
  GHL_LEAD_NOTICE_DISPATCH_JOB,
  readSmsCanaryIsolation,
} from "@sa360/shared";

import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

export const GHL_LEAD_NOTICE_ENABLED_ENV = "SA360_GHL_LEAD_NOTICE_ENABLED";

/** Exact string true. Default off. This does not read the webhook notice flag. */
export function isGhlLeadNoticeWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GHL_LEAD_NOTICE_ENABLED_ENV]?.trim() === "true";
}

export type GhlLeadNoticeJobOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
  env?: NodeJS.ProcessEnv;
};

/**
 * Calls the internal GHL lead-notice routes. Flag off returns before HTTP.
 * The route still refuses to call Twilio unless the SMS kill switch is on.
 */
export async function processGhlLeadNoticeJob(
  job: Job,
  options: GhlLeadNoticeJobOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  const env = options.env ?? process.env;
  if (readSmsCanaryIsolation(env).mode !== "off") {
    logger.info("ghl_lead_notice.skipped", { reason: "canary_isolation" });
    return { ok: true, skipped: "canary_isolation" };
  }
  if (!isGhlLeadNoticeWorkerEnabled(env)) {
    logger.info("ghl_lead_notice.skipped", { reason: "flag_off" });
    return { ok: true, skipped: "flag_off" };
  }
  if (job.name !== GHL_LEAD_NOTICE_DISPATCH_JOB && job.name !== GHL_LEAD_NOTICE_DISCOVER_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  const adminKey = env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("ghl_lead_notice.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const receiptId =
    job.data && typeof job.data === "object" && "receiptId" in job.data
      ? String((job.data as { receiptId?: unknown }).receiptId ?? "")
      : "";
  if (job.name === GHL_LEAD_NOTICE_DISPATCH_JOB && !receiptId.trim()) {
    throw new Error("ghl_lead_notice_receipt_id_required");
  }
  const path =
    job.name === GHL_LEAD_NOTICE_DISCOVER_JOB
      ? "/admin/v1/ghl-lead-notice/internal/discover"
      : "/admin/v1/ghl-lead-notice/internal/dispatch";
  const post = options.postImpl ?? postCompanySheetsDrain;
  const body = job.name === GHL_LEAD_NOTICE_DISPATCH_JOB ? JSON.stringify({ receiptId }) : "{}";
  try {
    const res = await post({
      url: `${apiBase}${path}`,
      headers: { "content-type": "application/json", "x-sa360-admin-key": adminKey },
      body,
      timeoutMs: options.timeoutMs ?? COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      logger.error("ghl_lead_notice.drain", { outcome: "http_error", statusCode: res.status });
      throw new Error("ghl_lead_notice_http_error");
    }
  } catch (err) {
    const timedOut =
      err instanceof CompanySheetsDrainTimeoutError ||
      (err instanceof Error && err.name === "CompanySheetsDrainTimeoutError");
    if (timedOut) throw new CompanySheetsDrainTimeoutError();
    throw err;
  }
  return { ok: true };
}
