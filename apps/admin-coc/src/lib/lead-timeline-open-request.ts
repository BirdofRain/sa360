import type { AdminLeadTimelineEntry } from "@/lib/admin-api/types";

export function canOpenWebhookRequest(row: Pick<AdminLeadTimelineEntry, "webhookLogId">): boolean {
  return Boolean(row.webhookLogId?.trim());
}

/** Label when a lifecycle row has no linked webhook request log. */
export function webhookOpenRequestUnavailableLabel(
  row: Pick<AdminLeadTimelineEntry, "webhookLogId" | "sourceTable" | "eventNameInternal">
): string | null {
  if (canOpenWebhookRequest(row)) return null;
  if (
    row.sourceTable === "LifecycleEvent" ||
    row.eventNameInternal === "lead_created" ||
    row.eventNameInternal === "appointment_set"
  ) {
    return "request unavailable";
  }
  return null;
}
