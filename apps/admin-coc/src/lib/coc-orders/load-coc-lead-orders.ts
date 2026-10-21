import "server-only";

import {
  fetchAdminLeadOrdersList,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import {
  mapApiLeadOrderToFrontOffice,
  type ApiLeadOrderRow,
} from "@/lib/front-office/live/orders-bridge";
import type { LeadOrder } from "@/lib/front-office/types";

const PAGE_LIMIT = "100";
const MAX_PAGES = 10;

export type CocLeadOrdersLoad = {
  orders: LeadOrder[];
  error: string | null;
  configured: boolean;
  truncated: boolean;
};

type LeadOrderListPage = {
  items: unknown[];
  nextCursor: string | null;
  error: string | null;
};

function isLeadOrderRow(item: unknown): item is ApiLeadOrderRow {
  if (!item || typeof item !== "object") return false;
  const row = item as Partial<ApiLeadOrderRow>;
  return typeof row.id === "string" && typeof row.orderNumber === "string";
}

export function mapCocLeadOrderItems(items: unknown[]): LeadOrder[] {
  const orders: LeadOrder[] = [];
  for (const item of items) {
    if (!isLeadOrderRow(item)) continue;
    orders.push(mapApiLeadOrderToFrontOffice(item));
  }
  return orders;
}

/**
 * Live admin lead-order read for the COC Orders page.
 * Does not call the Front Office list, which can substitute preview orders.
 */
export async function loadCocLeadOrders(
  fetchList: (params?: Record<string, string>) => Promise<LeadOrderListPage> = fetchAdminLeadOrdersList,
  configured: () => boolean = isAdminApiConfigured
): Promise<CocLeadOrdersLoad> {
  if (!configured()) {
    return {
      orders: [],
      error:
        "Admin API is not configured. Set NEXT_PUBLIC_SA360_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) and SA360_ADMIN_API_KEY.",
      configured: false,
      truncated: false,
    };
  }

  const items: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchList(cursor ? { limit: PAGE_LIMIT, cursor } : { limit: PAGE_LIMIT });
    if (result.error) {
      return { orders: [], error: result.error, configured: true, truncated: false };
    }
    items.push(...result.items);
    if (!result.nextCursor) {
      return {
        orders: mapCocLeadOrderItems(items),
        error: null,
        configured: true,
        truncated: false,
      };
    }
    if (seenCursors.has(result.nextCursor)) {
      return {
        orders: mapCocLeadOrderItems(items),
        error: null,
        configured: true,
        truncated: true,
      };
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  return {
    orders: mapCocLeadOrderItems(items),
    error: null,
    configured: true,
    truncated: true,
  };
}
