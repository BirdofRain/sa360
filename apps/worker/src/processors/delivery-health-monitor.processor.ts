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
    logger.error("delivery_health.scan", { outcome: "config_error", reason: "admin_key_missing" });
    throw new Error("delivery_health_config_error:admin_key_missing");
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
    const failure = scanResponseFailure(res.status, res.body);
    if (failure) {
      const configuration = failure === "api_flag_off" || failure === "pilot_unconfigured" || failure === "heartbeat_failed";
      logger.error("delivery_health.scan", {
        outcome: configuration ? "config_error" : "http_error",
        reason: failure,
        statusCode: res.status,
      });
      const kind = configuration ? "delivery_health_config_error" : "delivery_health_http_error";
      throw new Error(`${kind}:${failure}`);
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

type ScanBody = {
  ok?: boolean;
  skipped?: string;
  queried?: boolean;
  pilotClients?: number;
  error?: string;
  heartbeat?: string;
};

/** HTTP 200 is not a healthy scan. The body must show a configured pilot that ran. */
export function scanResponseFailure(status: number, body: string): string | null {
  const parsed = parseScanBody(body);
  if (status < 200 || status >= 300) return parsed?.error ?? "http_error";
  if (!parsed) return "body_unreadable";
  if (parsed.skipped === "flag_off") return "api_flag_off";
  if (parsed.ok !== true) return parsed.error ?? "scan_not_ok";
  if (parsed.queried !== true || typeof parsed.pilotClients !== "number" || parsed.pilotClients < 1) {
    return "pilot_unconfigured";
  }
  if (parsed.heartbeat === "failed") return parsed.error ?? "heartbeat_failed";
  return null;
}

function parseScanBody(body: string): ScanBody | null {
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return {
      ok: typeof record.ok === "boolean" ? record.ok : undefined,
      skipped: typeof record.skipped === "string" ? record.skipped : undefined,
      queried: typeof record.queried === "boolean" ? record.queried : undefined,
      pilotClients: typeof record.pilotClients === "number" ? record.pilotClients : undefined,
      error: typeof record.error === "string" ? record.error : undefined,
      heartbeat: typeof record.heartbeat === "string" ? record.heartbeat : undefined,
    };
  } catch {
    return null;
  }
}
