/**
 * Client portal adapter for GET /client/v1/lead-orders/:id/leads (PR #86).
 *
 * Portal convention is first-page-only (same as /portal/orders and /portal/leads).
 * The backend supports `nextCursor`; this adapter does not implement Load more.
 */

export const PORTAL_ORDER_LINKED_LEADS_PAGE_SIZE = 50;

export const PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR = "Order leads could not be loaded.";

export const PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE =
  "No delivered leads are linked to this order yet.";

export const PORTAL_ORDER_LINKED_LEADS_EMPTY_HINT =
  "Leads committed to this order will appear here after delivery is recorded.";

export const PORTAL_ORDER_LINKED_LEADS_FIRST_PAGE_NOTE =
  "Showing the first page of leads from this order.";

export function clientLeadOrderLeadsPath(opts: {
  id: string;
  clientAccountId: string;
  limit?: number;
  cursor?: string;
}): string {
  const params = new URLSearchParams({ clientAccountId: opts.clientAccountId });
  params.set("limit", String(opts.limit ?? PORTAL_ORDER_LINKED_LEADS_PAGE_SIZE));
  if (opts.cursor?.trim()) params.set("cursor", opts.cursor.trim());
  return `/client/v1/lead-orders/${encodeURIComponent(opts.id)}/leads?${params.toString()}`;
}

export function parseClientLeadOrderLeadsPayload(data: unknown): {
  items: unknown[];
  nextCursor: string | null;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { items: [], nextCursor: null };
  }
  const row = data as { items?: unknown; nextCursor?: unknown };
  const items = Array.isArray(row.items) ? row.items : [];
  const nextCursor =
    typeof row.nextCursor === "string" && row.nextCursor.trim() ? row.nextCursor.trim() : null;
  return { items, nextCursor };
}
