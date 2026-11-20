import type { Job } from "bullmq";
import { DELIVERY_HEALTH_MONITOR_JOB } from "@sa360/shared";

import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

export const DELIVERY_HEALTH_MONITOR_ENABLED_ENV = "SA360_DELIVERY_HEALTH_MONITOR_ENABLED";
const SCAN_TIMEOUT_MS = 60_000;

export function isDeliveryHealthMonitorWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DELIVERY_HEALTH_MONITOR_ENABLED_ENV]?.trim() === "true";
}

export type DeliveryHealthMonitorJobOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
  env?: NodeJS.ProcessEnv;
};

/**
 * Calls the internal delivery-health scan. Flag off returns before HTTP.
 * The scan is read-only. This processor does not call Google.
 */
export async function processDeliveryHealthMonitorJob(
  job: Job,
  options: DeliveryHealthMonitorJobOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  const env = options.env ?? process.env;
  if (!isDeliveryHealthMonitorWorkerEnabled(env)) {
    logger.info("delivery_health.skipped", { reason: "flag_off" });
    return { ok: true, skipped: "flag_off" };
  }
  if (job.name !== DELIVERY_HEALTH_MONITOR_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  const adminKey = env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("delivery_health.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const post = options.postImpl ?? postCompanySheetsDrain;
  try {
    const res = await post({
      url: `${apiBase}/admin/v1/delivery-health/internal/scan`,
      headers: { "content-type": "application/json", "x-sa360-admin-key": adminKey },
      body: "{}",
      timeoutMs: options.timeoutMs ?? SCAN_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      logger.error("delivery_health.scan", { outcome: "http_error", statusCode: res.status });
      throw new Error("delivery_health_http_error");
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
