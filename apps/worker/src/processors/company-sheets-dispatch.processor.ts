import type { Job } from "bullmq";
import { COMPANY_SHEETS_DISPATCH_JOB } from "@sa360/shared";

import { logger } from "../lib/logger.js";

function dispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Posts to the API dispatch drain. The worker does not import API code, does not call Google,
 * and does not read shared-drive storage settings. The API process enforces those settings.
 * Flag off and a missing admin key return without throwing so a default-off worker does not crash-loop.
 */
export async function processCompanySheetsDispatchJob(job: Job): Promise<{ ok: true; skipped?: string }> {
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
  const res = await fetch(`${apiBase}/admin/v1/company-sheets/internal/process-dispatch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": adminKey,
    },
    body: JSON.stringify({}),
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`company_sheets_dispatch_failed:${res.status}:${responseText.slice(0, 200)}`);
  }
  return responseText ? (JSON.parse(responseText) as { ok: true }) : { ok: true };
}
