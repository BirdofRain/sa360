import type { Job } from "bullmq";
import { COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS, GHL_ASSOCIATION_DISPATCH_JOB } from "@sa360/shared";
import {
  CompanySheetsDrainTimeoutError,
  postCompanySheetsDrain,
  type CompanySheetsDrainRequest,
  type CompanySheetsDrainResponse,
} from "../lib/company-sheets-drain-http.js";
import { logger } from "../lib/logger.js";

function serviceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_GHL_ONGOING_DELIVERY_ENABLED?.trim().toLowerCase() === "true";
}

export type GhlAssociationDispatchOptions = {
  timeoutMs?: number;
  postImpl?: (input: CompanySheetsDrainRequest) => Promise<CompanySheetsDrainResponse>;
  env?: NodeJS.ProcessEnv;
};

/**
 * One drain request. A timeout throws and does not POST again.
 * The API keeps the outbox claim. The next interval is a new job.
 * Flag off returns without calling the API.
 */
export async function processGhlAssociationDispatchJob(
  job: Job,
  options: GhlAssociationDispatchOptions = {}
): Promise<{ ok: true; skipped?: string }> {
  if (job.name !== GHL_ASSOCIATION_DISPATCH_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }
  const env = options.env ?? process.env;
  if (!serviceEnabled(env)) {
    logger.info("ghl_association_dispatch.skipped", { reason: "service_disabled" });
    return { ok: true, skipped: "service_disabled" };
  }
  const adminKey = env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    logger.error("ghl_association_dispatch.skipped", { reason: "admin_key_missing" });
    return { ok: true, skipped: "admin_key_missing" };
  }
  const apiBase = env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const timeoutMs = options.timeoutMs ?? COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS;
  const post = options.postImpl ?? postCompanySheetsDrain;
  try {
    const res = await post({
      url: `${apiBase}/admin/v1/ghl/internal/process-association-dispatch`,
      headers: {
        "content-type": "application/json",
        "x-sa360-admin-key": adminKey,
      },
      body: "{}",
      timeoutMs,
    });
    if (res.status < 200 || res.status >= 300) {
      logger.error("ghl_association_dispatch.drain", { outcome: "http_error", statusCode: res.status });
      throw new Error("ghl_association_dispatch_http_error");
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
