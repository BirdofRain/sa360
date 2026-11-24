/**
 * Customer-safe lead-list status filter for GET /client/v1/lead-delivery.
 *
 * `status=delivered` asks the client API for rows whose customer badge is
 * Delivered. That membership uses the receipt verdict and still includes a
 * legacy source-status delivered row that has no association run. It is not a
 * SourceLeadEvent.status filter. Internal source statuses (approved,
 * delivery_failed, …) are not exposed. Presented labels such as pending/failed
 * are not valid query values and must not be forwarded to the API.
 *
 * `q`, `from`, and `to` are the same search and receivedAt window on All and
 * Delivered. They are applied before membership and before pagination.
 */

export type PortalLeadListFilters = {
  q?: string;
  from?: string;
  to?: string;
};

export const PORTAL_LEAD_LIST_STATUS_QUERY = "status";
export const PORTAL_LEAD_LIST_CURSOR_QUERY = "cursor";
/** One customer page. The API scan budget stays separate and can end a page early. */
export const PORTAL_LEAD_LIST_PAGE_SIZE = 50;
export const PORTAL_LEAD_LIST_NEXT_LABEL = "Next";
export const PORTAL_LEAD_LIST_CONTINUE_LABEL = "Continue searching older leads";

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

function appendPortalLeadListFilters(
  params: URLSearchParams,
  filters?: PortalLeadListFilters
): void {
  const q = filters?.q?.trim();
  const from = filters?.from?.trim();
  const to = filters?.to?.trim();
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
}

export function portalLeadListPath(
  status: PortalLeadListStatus | string = "all",
  filters?: PortalLeadListFilters
): string {
  const resolved = parsePortalLeadListStatus(typeof status === "string" ? status : undefined);
  const params = new URLSearchParams();
  if (resolved !== "all") {
    params.set(PORTAL_LEAD_LIST_STATUS_QUERY, resolved);
  }
  appendPortalLeadListFilters(params, filters);
  const query = params.toString();
  return query ? `/portal/leads?${query}` : "/portal/leads";
}

/**
 * Next page of the current Delivered filters. Filter changes use
 * `portalLeadListPath`, which omits the cursor.
 */
export function portalLeadListCursorPath(
  status: PortalLeadListStatus | string,
  filters: PortalLeadListFilters | undefined,
  cursor: string
): string {
  const trimmed = cursor.trim();
  const base = portalLeadListPath(status, filters);
  const url = new URL(base, "http://localhost");
  url.searchParams.set(PORTAL_LEAD_LIST_CURSOR_QUERY, trimmed);
  return `${url.pathname}${url.search}`;
}

/**
 * Delivered pagination. A full page of matches offers Next. A bounded scan
 * that matched nothing still offers the cursor. The final empty state is only
 * when that cursor is absent.
 */
export function portalLeadsContinuation(input: {
  status: PortalLeadListStatus;
  filters?: PortalLeadListFilters;
  itemCount: number;
  nextCursor: string | null;
}): { href: string; label: string } | null {
  const cursor = input.nextCursor?.trim();
  if (input.status !== "delivered" || !cursor) return null;
  return {
    href: portalLeadListCursorPath(input.status, input.filters, cursor),
    label: input.itemCount === 0 ? PORTAL_LEAD_LIST_CONTINUE_LABEL : PORTAL_LEAD_LIST_NEXT_LABEL,
  };
}

/** Value forwarded to GET /client/v1/lead-delivery. Omit for All. */
export function portalLeadListApiStatus(
  status: PortalLeadListStatus
): string | undefined {
  return status === "delivered" ? "delivered" : undefined;
}

export function portalLeadListHeading(status: PortalLeadListStatus): string {
  return status === "delivered" ? "Delivered leads" : "Leads";
}

export function portalLeadListPageSubtitle(status: PortalLeadListStatus): string {
  if (status === "delivered") {
    return "Leads delivered to your account. Contact details stay masked.";
  }
  return "Leads on your account. Contact details stay masked.";
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
    title: "No leads yet",
    hint: "Leads for your account will appear here.",
  };
}
