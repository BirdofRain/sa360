import type { Job } from "bullmq";
import { FACETS_SUPPLY_REBUILD_JOB, LEAD_INVENTORY_AGE_BAND_VERSION } from "@sa360/shared";

import { logger } from "../lib/logger.js";

export type FacetsSupplyRebuildJobData = {
  ageBandVersion?: string;
  requestedBy?: "schedule" | "admin" | "worker";
};

/**
 * Worker invokes the API-internal rebuild endpoint (same pattern as fulfillment-shadow).
 * Rebuild SQL and activation stay in @sa360/api; worker only orchestrates.
 */
export async function processFacetsSupplyRebuildJob(job: Job<FacetsSupplyRebuildJobData>) {
  if (job.name !== FACETS_SUPPLY_REBUILD_JOB) {
    throw new Error(`unexpected_job_name:${job.name}`);
  }

  const apiBase = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY missing for facets supply rebuild worker");
  }

  const ageBandVersion = job.data.ageBandVersion?.trim() || LEAD_INVENTORY_AGE_BAND_VERSION;
  const requestedBy = job.data.requestedBy ?? "worker";
  const jobId = String(job.id);

  logger.info("facets_supply_rebuild.dispatch", {
    jobId,
    ageBandVersion,
    requestedBy,
  });

  const res = await fetch(`${apiBase}/admin/v1/lead-inventory/facets/snapshot/internal/rebuild`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": adminKey,
    },
    body: JSON.stringify({ ageBandVersion, jobId, requestedBy }),
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`facets_supply_rebuild_failed:${res.status}:${responseText.slice(0, 200)}`);
  }

  let payload: {
    ok?: boolean;
    buildId?: string | null;
    status?: string | null;
    inventoryCount?: number | null;
    aggregateRowCount?: number | null;
    buildDurationMs?: number | null;
    failureCode?: string | null;
  };
  try {
    payload = responseText ? (JSON.parse(responseText) as typeof payload) : {};
  } catch {
    throw new Error(`facets_supply_rebuild_failed:invalid_json:${responseText.slice(0, 200)}`);
  }

  if (payload.ok !== true) {
    logger.error("facets_supply_rebuild.failed", {
      jobId,
      ageBandVersion,
      ok: payload.ok ?? false,
      buildId: payload.buildId ?? null,
      status: payload.status ?? null,
      failureCode: payload.failureCode ?? null,
    });
    throw new Error(
      `facets_supply_rebuild_failed:${payload.failureCode ?? "rebuild_not_ok"}:${responseText.slice(0, 200)}`
    );
  }

  logger.info("facets_supply_rebuild.complete", {
    jobId,
    ageBandVersion,
    ok: true,
    buildId: payload.buildId ?? null,
    status: payload.status ?? null,
    inventoryCount: payload.inventoryCount ?? null,
    aggregateRowCount: payload.aggregateRowCount ?? null,
    buildDurationMs: payload.buildDurationMs ?? null,
    failureCode: payload.failureCode ?? null,
  });

  return payload;
}
