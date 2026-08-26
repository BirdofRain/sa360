/**
 * Customer-safe lead-list status filter for GET /client/v1/lead-delivery.
 *
 * The existing `status` query filters SourceLeadEvent.status in the same
 * tenant-scoped WHERE (not the presented deliveryStatus). The only value that
 * is both a valid source-status filter and a customer-facing delivery status
 * is `delivered`. Internal source statuses (approved, delivery_failed, …)
 * are not exposed. Presented labels such as pending/failed are not valid
 * query values and must not be forwarded to the API.
 */

export const PORTAL_LEAD_LIST_STATUS_QUERY = "status";

export const PORTAL_LEAD_LIST_STATUSES = ["all", "delivered"] as const;

export type PortalLeadListStatus = (typeof PORTAL_LEAD_LIST_STATUSES)[number];

export const PORTAL_LEAD_LIST_STATUS_OPTIONS: ReadonlyArray<{
  value: PortalLeadListStatus;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "delivered", label: "Delivered" },
];

export function firstPortalSearchParam(
  value: string | string[] | undefined
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function parsePortalLeadListStatus(
  raw: string | undefined
): PortalLeadListStatus {
  const value = raw?.trim().toLowerCase();
  if (value === "delivered") return "delivered";
  return "all";
}

export function portalLeadListPath(status: PortalLeadListStatus = "all"): string {
  if (status === "all") return "/portal/leads";
  return `/portal/leads?${PORTAL_LEAD_LIST_STATUS_QUERY}=${encodeURIComponent(status)}`;
}

/** Value forwarded to GET /client/v1/lead-delivery. Omit for All. */
export function portalLeadListApiStatus(
  status: PortalLeadListStatus
): string | undefined {
  return status === "delivered" ? "delivered" : undefined;
}

export function portalLeadListEmptyCopy(status: PortalLeadListStatus): {
  title: string;
  hint: string;
} {
  if (status === "delivered") {
    return {
      title: "No delivered leads match this filter.",
      hint: "Other leads may still be on your account. Choose All to see every lead we can show.",
    };
  }
  return {
    title: "No delivered leads yet",
    hint: "Leads routed to your account will appear here after delivery is recorded.",
  };
}
