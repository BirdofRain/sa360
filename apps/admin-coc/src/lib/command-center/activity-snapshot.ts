export const EASTERN_TIME_ZONE = "America/New_York";

/**
 * Leads received today cannot be counted from the existing source-intake read.
 * The activity section states the summary and does not render a card.
 */
export const LEADS_RECEIVED_TODAY_GAP = {
  metric: "leads_received_today",
  timeZone: EASTERN_TIME_ZONE,
  supported: false as const,
  summary:
    "Leads received today is omitted. Source Intake cannot filter receivedAt to an America/New_York day, and GHL lifecycle webhook traffic is not the intake count.",
  gaps: [
    "GET /admin/v1/source-leads accepts status, sourceProvider, sourceSystem, matched, clientAccountIdResolved, includeCleanup, cleanupStatus, limit, and cursor. sourceLeadListQuerySchema is strict, so receivedFrom, receivedTo, from, and to are rejected.",
    "buildSourceLeadEventWhere does not set receivedAt. Walking every page and dropping rows outside the Eastern day stops at the page cap and does not match a queue an operator can open.",
    "Source Intake search params have no received-day field, so /source-intake cannot show that set.",
    "Duplicates: duplicate_blocked is its own status. The list accepts one status, so a day total cannot include ordinary intake and exclude duplicates.",
    "Retries: LeadCapture Next-Gen replay, LeadConduit terminal replay, and Meta canonical claim return the existing SourceLeadEvent and do not insert a second receivedAt. The list has no retry flag.",
    "Test leads: Meta testLead or fixture lives in the raw payload, and ClientOnboardingTestRun is a relation. Neither is a list filter or a list-item field.",
    "GHL lifecycle WebhookRequestLog on GET /admin/v1/coc/summary-metrics uses UTC midnight, and LifecycleEvent lead_created on the automation leadsToday count also uses UTC midnight. Neither is a canonical intake record.",
  ],
} as const;

/**
 * What the delivery-failure card counts, and the failure records it leaves out.
 * The count matches Source Intake `?status=delivery_failed`.
 */
export const DELIVERY_FAILURE_SCOPE = {
  status: "delivery_failed",
  queue: "/source-intake?status=delivery_failed",
  included:
    "SourceLeadEvent rows whose current status is delivery_failed. That status is written after an external delivery write was attempted and failed. Source Intake requires an operator to requeue before another attempt.",
  excluded: [
    "Requeue replaces delivery_failed with routing_matched or routing_unmatched.",
    "A later successful external write sets status delivered.",
    "Pre-write blocks, duplicate live-delivery blocks, and company-sheets pilot blocks do not set delivery_failed.",
    "duplicate_blocked and rejected are different statuses.",
    "DeliveryAttempt skipped, retryable_failure, and terminal_failure have no operator list to open.",
    "Buyer delivery failures are not wired: loadFulfillmentOverviewCounts leaves deliveryFailures at availability not_wired.",
    "Association ongoing delivery can return reason delivery_failed without updating SourceLeadEvent.status.",
    "Bulk import row deliveryStatus failed is not this queue.",
    "GHL lifecycle event name delivery_failed is not this queue.",
    "Cleanup-marked rows are omitted by the shared source-lead list default, which is also what Source Intake shows.",
  ],
} as const;

type EasternTimestampParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  dayPeriod: string;
  timeZoneName: string;
};

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((item) => item.type === type)?.value;
  if (!value) throw new Error(`eastern_timestamp_missing_${type}`);
  return value;
}

export function easternCalendarDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

export function easternTimestampParts(instant: Date): EasternTimestampParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
    timeZoneName: "short",
  }).formatToParts(instant);
  return {
    year: part(parts, "year"),
    month: part(parts, "month"),
    day: part(parts, "day"),
    hour: part(parts, "hour"),
    minute: part(parts, "minute"),
    dayPeriod: part(parts, "dayPeriod"),
    timeZoneName: part(parts, "timeZoneName"),
  };
}

export function formatEasternTimestamp(instant: Date): string {
  const parts = easternTimestampParts(instant);
  return `${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
}

export function deliveryFailureRefreshedLabel(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "Refreshed time unavailable";
  return `Refreshed ${formatEasternTimestamp(instant)}`;
}
