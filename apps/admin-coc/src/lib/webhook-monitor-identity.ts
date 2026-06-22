import type { AdminWebhookDetail, AdminWebhookListItem } from "@/lib/admin-api/types";

export const UNKNOWN_LEAD = "Unknown lead";

export type WebhookRowIdentityOverride = {
  leadName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
};

/** Lead name for a list row, preferring a detail-fetched override over a (possibly stale) list value. */
export function webhookRowLeadName(
  row: Pick<AdminWebhookListItem, "leadName">,
  override?: WebhookRowIdentityOverride
): string {
  return override?.leadName?.trim() || row.leadName?.trim() || UNKNOWN_LEAD;
}

/** Authoritative identity from a fetched detail — matches the drawer's top-line lead. */
export function webhookIdentityOverrideFromDetail(
  detail: Pick<AdminWebhookDetail, "leadName" | "leadPhone" | "leadEmail"> & {
    debug?: { topLine?: { lead?: string | null } };
  }
): WebhookRowIdentityOverride {
  const leadName = detail.debug?.topLine?.lead?.trim() || detail.leadName?.trim() || null;
  return {
    leadName,
    leadPhone: detail.leadPhone?.trim() || null,
    leadEmail: detail.leadEmail?.trim() || null,
  };
}
