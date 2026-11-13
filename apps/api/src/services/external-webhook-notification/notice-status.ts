/**
 * Allowed external-webhook notice transitions.
 * The database trigger enforces the same edges. Twilio create-call success is
 * provider_accepted. sent requires a later delivery-status fact.
 */

export const EXTERNAL_WEBHOOK_NOTICE_STATUSES = [
  "pending",
  "sending",
  "provider_accepted",
  "sent",
  "failed",
  "uncertain",
  "suppressed",
] as const;

export type ExternalWebhookNoticeStatusName = (typeof EXTERNAL_WEBHOOK_NOTICE_STATUSES)[number];

const EDGES: Record<ExternalWebhookNoticeStatusName, readonly ExternalWebhookNoticeStatusName[]> = {
  pending: ["sending", "suppressed"],
  sending: ["provider_accepted", "failed", "uncertain", "suppressed"],
  provider_accepted: ["sent", "failed", "suppressed"],
  uncertain: ["provider_accepted", "failed", "suppressed"],
  sent: [],
  failed: [],
  suppressed: [],
};

/** Status words that may be stored. A provider response body is not one of them. */
export const STORABLE_PROVIDER_STATUSES = new Set([
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "undelivered",
  "failed",
  "canceled",
  "partially_delivered",
]);

export const DELIVERY_CONFIRMATION_STATUSES = new Set(["delivered", "read"]);

export function canTransitionNotice(
  from: ExternalWebhookNoticeStatusName,
  to: ExternalWebhookNoticeStatusName
): boolean {
  return EDGES[from].includes(to);
}

export function providerStatusIsStorable(status: string): boolean {
  return STORABLE_PROVIDER_STATUSES.has(status);
}

export function providerStatusConfirmsDelivery(status: string): boolean {
  return DELIVERY_CONFIRMATION_STATUSES.has(status);
}
