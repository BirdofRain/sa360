import type { Job } from "bullmq";
import {
  COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
  EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB,
  EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB,
} from "@sa360/shared";

import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

export const EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED_ENV = "SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED";

/** Same exact-true rule as the API discovery gate. Default off. */
export function isExternalWebhookNoticeWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED_ENV]?.trim() === "true";
}

export type ExternalWebhookNoticeJobOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
  env?: NodeJS.ProcessEnv;
};

/**
 * Calls the internal notice routes. Flag off returns before HTTP.
 */
export async function processExternalWebhookNoticeJob(
  job: Job,
  options: ExternalWebhookNoticeJobOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  const env = options.env ?? process.env;
  if (!isExternalWebhookNoticeWorkerEnabled(env)) {
    logger.info("external_webhook_notice.skipped", { reason: "flag_off" });
    return { ok: true, skipped: "flag_off" };
  }
  if (job.name !== EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB && job.name !== EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  const adminKey = env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("external_webhook_notice.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const receiptId =
    job.data && typeof job.data === "object" && "receiptId" in job.data
      ? String((job.data as { receiptId?: unknown }).receiptId ?? "")
      : "";
  if (job.name === EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB && !receiptId.trim()) {
    throw new Error("external_webhook_notice_receipt_id_required");
  }
  const path =
    job.name === EXTERNAL_WEBHOOK_NOTICE_DISCOVER_JOB
      ? "/admin/v1/external-webhook-notice/internal/discover"
      : "/admin/v1/external-webhook-notice/internal/dispatch";
  const post = options.postImpl ?? postCompanySheetsDrain;
  const body = job.name === EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB ? JSON.stringify({ receiptId }) : "{}";
  try {
    const res = await post({
      url: `${apiBase}${path}`,
      headers: { "content-type": "application/json", "x-sa360-admin-key": adminKey },
      body,
      timeoutMs: options.timeoutMs ?? COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      logger.error("external_webhook_notice.drain", { outcome: "http_error", statusCode: res.status });
      throw new Error("external_webhook_notice_http_error");
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
