import type { MetaLeadgenFetchState } from "./types";

/**
 * Pure presentation helpers for direct Meta Lead Ads rows in Source Intake.
 * Kept free of React/server-action imports so they can be unit tested.
 */

/**
 * Direct Meta Graph fetch can be requeued when the worker job ended terminally
 * or never enqueued, and the row is still raw (not captured/normalized).
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
  const state = row.metaLeadgenFetch?.state;
  return state === "failed" || state === "enqueue_failed" || state === "retrying";
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
