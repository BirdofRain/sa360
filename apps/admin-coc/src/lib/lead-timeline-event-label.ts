import type { AdminLeadTimelineEntry } from "@/lib/admin-api/types";

/**
 * Operator label for a timeline row.
 * LeadCapture intake webhooks keep routing_matched as their status. Their
 * stored event name is not a persisted lifecycle event and is not delivery.
 */
export function leadTimelineEventLabel(
  row: Pick<AdminLeadTimelineEntry, "source" | "sourceTable" | "eventNameInternal" | "processingStatus">
): string {
  if (row.sourceTable === "WebhookRequestLog" && row.source !== "ghl_lifecycle") {
    const status = row.processingStatus.trim();
    return status ? `intake webhook · ${status}` : "intake webhook";
  }
  return row.eventNameInternal?.trim() || row.source;
}
