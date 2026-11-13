import type { Job } from "bullmq";
import {
  COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
  EXTERNAL_WEBHOOK_DELIVERY_JOB,
  EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB,
} from "@sa360/shared";

import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

/** Same exact-true rule as isExternalWebhookDeliveryEnabled in the API. */
export function isExternalWebhookWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED?.trim() === "true";
}

export type ExternalWebhookDeliveryOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
  env?: NodeJS.ProcessEnv;
};

/**
 * Triggers one API delivery or a recovery pass.
 * Flag off returns before any HTTP call, including the internal admin route.
 * This worker does not call GoHighLevel or Google.
 */
export async function processExternalWebhookDeliveryJob(
  job: Job,
  options: ExternalWebhookDeliveryOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  const env = options.env ?? process.env;
  if (!isExternalWebhookWorkerEnabled(env)) {
    logger.info("external_webhook_delivery.skipped", { reason: "flag_off" });
    return { ok: true, skipped: "flag_off" };
  }
  if (job.name !== EXTERNAL_WEBHOOK_DELIVERY_JOB && job.name !== EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  const adminKey = env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("external_webhook_delivery.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const path =
    job.name === EXTERNAL_WEBHOOK_DELIVERY_RECOVER_JOB
      ? "/admin/v1/external-webhook/internal/recover"
      : "/admin/v1/external-webhook/internal/deliver";
  const attemptId =
    job.data && typeof job.data === "object" && "attemptId" in job.data
      ? String((job.data as { attemptId?: unknown }).attemptId ?? "")
      : "";
  if (job.name === EXTERNAL_WEBHOOK_DELIVERY_JOB && !attemptId.trim()) {
    throw new Error("external_webhook_attempt_id_required");
  }
  const post = options.postImpl ?? postCompanySheetsDrain;
  const body = job.name === EXTERNAL_WEBHOOK_DELIVERY_JOB ? JSON.stringify({ attemptId }) : "{}";
  try {
    const res = await post({
      url: `${apiBase}${path}`,
      headers: {
        "content-type": "application/json",
        "x-sa360-admin-key": adminKey,
      },
      body,
      timeoutMs: options.timeoutMs ?? COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      logger.error("external_webhook_delivery.drain", { outcome: "http_error", statusCode: res.status });
      throw new Error("external_webhook_delivery_http_error");
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
