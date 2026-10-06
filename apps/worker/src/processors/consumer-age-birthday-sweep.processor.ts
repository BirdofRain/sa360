import type { Job } from "bullmq";
import { CONSUMER_AGE_BIRTHDAY_SWEEP_JOB } from "@sa360/shared";

import { logger } from "../lib/logger.js";

export type ConsumerAgeBirthdaySweepCursor = {
  afterGeneratedAt: string;
  afterId: string;
};

export type ConsumerAgeBirthdaySweepJobData = {
  cursor?: ConsumerAgeBirthdaySweepCursor | null;
  /** Caps the continuations this tick may chain. Defaults to the env budget. */
  maxBatches?: number;
  requestedBy?: "schedule" | "admin" | "worker";
};

type SweepBatchPayload = {
  ok?: boolean;
  outcome?: string | null;
  enabled?: boolean;
  coverage?: string | null;
  nextCursor?: ConsumerAgeBirthdaySweepCursor | null;
  rowsScanned?: number | null;
  candidatesInScannedWindow?: number | null;
  candidatesWritten?: number | null;
  reasonCode?: string | null;
};

/** Continuations one tick may chain. Default 10; clamped to [1, 100]. */
function envMaxBatches(): number {
  const raw = process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_BATCHES;
  if (raw == null || raw.trim() === "") return 10;
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) return 10;
  return parsed;
}

/**
 * Worker invokes the API-internal sweep endpoint (same pattern as the facets
 * supply rebuild). Every consumer-age rule — candidate selection, the age
 * resolver, the lifecycle write, the environment guard, the feature flag —
 * stays in @sa360/api; the worker only orchestrates the cadence.
 *
 * A repeatable job cannot carry a moving cursor in its data, so one tick chains
 * the returned `nextCursor` in place, up to a bounded continuation budget. The
 * tick stops at `coverage == "complete"` with a null cursor, or when the budget
 * runs out — in which case the next tick starts the scope over, which is safe
 * because classified rows leave the scope.
 *
 * Logs carry counts only; no consumer data is emitted.
 */
export async function processConsumerAgeBirthdaySweepJob(
  job: Job<ConsumerAgeBirthdaySweepJobData>
) {
  if (job.name !== CONSUMER_AGE_BIRTHDAY_SWEEP_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }

  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY missing for consumer age birthday sweep worker");
  }

  const requestedBy = job.data.requestedBy ?? "worker";
  const jobId = String(job.id);
  const maxBatches =
    job.data.maxBatches != null && job.data.maxBatches >= 1
      ? Math.trunc(job.data.maxBatches)
      : envMaxBatches();

  let cursor = job.data.cursor ?? null;
  let batches = 0;
  let rowsScanned = 0;
  let candidatesWritten = 0;
  let last: SweepBatchPayload = {};

  logger.info("consumer_age_birthday_sweep.dispatch", {
    jobId,
    requestedBy,
    resumed: cursor != null,
    maxBatches,
  });

  while (batches < maxBatches) {
    const res = await fetch(`${apiBase}/admin/v1/consumer-age/internal/birthday-sweep`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sa360-admin-key": adminKey,
      },
      body: JSON.stringify({ cursor, jobId, requestedBy }),
    });

    const responseText = await res.text();
    if (!res.ok) {
      throw new Error(
        `consumer_age_birthday_sweep_failed:${res.status}:${responseText.slice(0, 200)}`
      );
    }

    let payload: SweepBatchPayload;
    try {
      payload = responseText ? (JSON.parse(responseText) as SweepBatchPayload) : {};
    } catch {
      throw new Error(
        `consumer_age_birthday_sweep_failed:invalid_json:${responseText.slice(0, 200)}`
      );
    }

    if (payload.ok !== true) {
      logger.error("consumer_age_birthday_sweep.failed", {
        jobId,
        batches,
        outcome: payload.outcome ?? null,
        reasonCode: payload.reasonCode ?? null,
      });
      throw new Error(
        `consumer_age_birthday_sweep_failed:${payload.reasonCode ?? "sweep_not_ok"}:${responseText.slice(0, 200)}`
      );
    }

    batches += 1;
    rowsScanned += payload.rowsScanned ?? 0;
    candidatesWritten += payload.candidatesWritten ?? 0;
    last = payload;

    // A disabled sweep is a successful no-op and must not be chained.
    if (payload.enabled !== true) break;
    if (payload.coverage !== "partial" || payload.nextCursor == null) break;
    cursor = payload.nextCursor;
  }

  const result = {
    ok: true,
    outcome: last.outcome ?? null,
    enabled: last.enabled ?? false,
    coverage: last.coverage ?? null,
    nextCursor: last.nextCursor ?? null,
    batches,
    rowsScanned,
    candidatesWritten,
  };

  logger.info("consumer_age_birthday_sweep.complete", {
    jobId,
    ...result,
    nextCursor: undefined,
    hasNextCursor: result.nextCursor != null,
    budgetExhausted: batches >= maxBatches && result.nextCursor != null,
  });

  return result;
}
