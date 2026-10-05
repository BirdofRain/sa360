import type { MetaLeadgenFetchState } from "./types";

/**
 * Pure presentation helpers for direct Meta Lead Ads rows in Source Intake.
 * Kept free of React/server-action imports so they can be unit tested.
 */

/**
 * Direct Meta Graph fetch can be requeued while the row is still raw (status
 * `received`, not captured/normalized) and no fetch is actively running.
 *
 * This deliberately includes rows with no fetch state (stored while
 * SA360_META_LEAD_ADS_INTAKE_ENABLED was off) and rows stuck in `queued`
 * (job consumed as `flags_disabled`, or Redis lost it). The API refuses a
 * requeue with 409 when a live BullMQ job still exists, so exposing the
 * action here cannot double-run a healthy job.
 */
export function canRequeueMetaFetch(row: {
  sourceSystem: string;
  status: string;
  captureOnly?: boolean;
  metaLeadgenFetch?: MetaLeadgenFetchState | null;
}): boolean {
  if (row.sourceSystem !== "meta_lead_ads") return false;
  if (row.captureOnly) return false;
  if (row.status !== "received") return false;
  return row.metaLeadgenFetch?.state !== "fetching";
}

export function metaFetchBadgeClass(state: string | null | undefined): string {
  if (state === "captured" || state === "normalized" || state === "routing_matched" || state === "completed") {
    return "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40";
  }
  if (state === "failed" || state === "enqueue_failed") return "bg-destructive/15 text-destructive";
  if (state === "retrying" || state === "routing_review_required") {
    return "bg-amber-50 text-amber-950 dark:bg-amber-950/35";
  }
  return "bg-muted text-muted-foreground";
}

/**
 * Short label for the Source client cell. Never reuses destination/routing fields,
 * so a captured-but-undelivered lead reads as associated without looking routed.
 */
export function sourceClientLabel(row: {
  captureOnly?: boolean;
  sourceClientAccountId?: string | null;
  associationOutcome?: string | null;
}): string {
  if (!row.captureOnly) return "—";
  if (row.sourceClientAccountId) return row.sourceClientAccountId;
  if (row.associationOutcome === "association_disabled") return "association off";
  if (row.associationOutcome === "ambiguous") return "ambiguous";
  if (row.associationOutcome === "missing_form_identity" || row.associationOutcome === "invalid_form_identity") {
    return "no form identity";
  }
  return "unassociated";
}
