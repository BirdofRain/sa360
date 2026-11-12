import "server-only";

import {
  fetchAdminSourceLeads,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import type { AdminCocAccess } from "@/lib/admin-coc-session-guard";
import { readAdminCocAccess } from "@/lib/admin-coc-session-guard";
import { loadCocLeadOrders, type CocLeadOrdersLoad } from "@/lib/coc-orders/load-coc-lead-orders";
import { orderAwaitsOperatorAction } from "@/lib/front-office/order-review";
import type { DeliveryFailureRead } from "@/lib/command-center/activity-snapshot-read";
import {
  SOURCE_INTAKE_AWAITING_REVIEW_STATUS,
  SOURCE_INTAKE_DELIVERY_FAILED_STATUS,
} from "@/lib/source-intake/source-intake-query";
import type { AttentionRead } from "@/lib/command-center/attention-read";

export type { AttentionRead };

type SourceLeadPage = {
  items: unknown[];
  nextCursor: string | null;
  error: string | null;
};

const SOURCE_PAGE_LIMIT = "200";
const SOURCE_MAX_PAGES = 50;

const ORDERS_DENIED =
  "The orders queue is limited to administrators. This role cannot open it.";
const SOURCE_DENIED =
  "Source intake is not available for this role.";
const ORDERS_INCOMPLETE =
  "The orders list stopped before the end, so this count would be incomplete.";
const SOURCE_INCOMPLETE =
  "The source intake list stopped before the end, so this count would be incomplete.";
const DELIVERY_INCOMPLETE =
  "The source intake list stopped before the end, so the delivery failure count would be incomplete.";
const API_UNCONFIGURED =
  "Admin API is not configured. Set NEXT_PUBLIC_SA360_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) and SA360_ADMIN_API_KEY.";

/**
 * Orders queue permission matches `requireAdminCocAdminSession`.
 * Shared-password admins and staff administrators are `kind: "admin"`.
 * Observers and team workspace roles are not.
 */
export function canReadOrdersQueue(access: AdminCocAccess): boolean {
  return access.kind === "admin";
}

/**
 * Source Intake is an observer document, and GET /admin/v1/source-leads is allowlisted.
 * Team workspace roles are not on that allowlist.
 */
export function canReadSourceIntakeQueue(access: AdminCocAccess): boolean {
  return access.kind === "admin" || access.kind === "observer";
}

export async function loadOrdersAwaitingOperatorAction(
  deps: {
    readAccess?: () => Promise<AdminCocAccess>;
    loadOrders?: () => Promise<CocLeadOrdersLoad>;
  } = {}
): Promise<AttentionRead> {
  const readAccess = deps.readAccess ?? readAdminCocAccess;
  const loadOrders = deps.loadOrders ?? (() => loadCocLeadOrders());
  const access = await readAccess();
  if (!canReadOrdersQueue(access)) {
    return { state: "unavailable", reason: ORDERS_DENIED };
  }

  const loaded = await loadOrders();
  if (!loaded.configured) {
    return { state: "unavailable", reason: loaded.error ?? API_UNCONFIGURED };
  }
  if (loaded.error) {
    return { state: "unavailable", reason: loaded.error };
  }
  if (loaded.truncated) {
    return { state: "unavailable", reason: ORDERS_INCOMPLETE };
  }

  return {
    state: "ready",
    count: loaded.orders.filter(orderAwaitsOperatorAction).length,
  };
}

type SourceLeadCountDeps = {
  readAccess?: () => Promise<AdminCocAccess>;
  fetchPage?: (params: Record<string, string>) => Promise<SourceLeadPage>;
  configured?: () => boolean;
};

async function countSourceLeadsByStatus(
  status: string,
  incompleteReason: string,
  deps: SourceLeadCountDeps
): Promise<AttentionRead> {
  const readAccess = deps.readAccess ?? readAdminCocAccess;
  const fetchPage = deps.fetchPage ?? fetchAdminSourceLeads;
  const configured = deps.configured ?? isAdminApiConfigured;
  const access = await readAccess();
  if (!canReadSourceIntakeQueue(access)) {
    return { state: "unavailable", reason: SOURCE_DENIED };
  }
  if (!configured()) {
    return { state: "unavailable", reason: API_UNCONFIGURED };
  }

  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let count = 0;
  for (let page = 0; page < SOURCE_MAX_PAGES; page += 1) {
    const params: Record<string, string> = {
      status,
      limit: SOURCE_PAGE_LIMIT,
    };
    if (cursor) params.cursor = cursor;
    const result = await fetchPage(params);
    if (result.error) {
      return { state: "unavailable", reason: result.error };
    }
    count += result.items.length;
    if (!result.nextCursor) {
      return { state: "ready", count };
    }
    if (seenCursors.has(result.nextCursor)) {
      return { state: "unavailable", reason: incompleteReason };
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  return { state: "unavailable", reason: incompleteReason };
}

export async function loadSourceIntakeAwaitingReview(
  deps: SourceLeadCountDeps = {}
): Promise<AttentionRead> {
  return countSourceLeadsByStatus(SOURCE_INTAKE_AWAITING_REVIEW_STATUS, SOURCE_INCOMPLETE, deps);
}

/**
 * Current `delivery_failed` source leads. Recovered retries and skips are other
 * statuses, so this filter leaves them out. The timestamp is when the read finished.
 */
export async function loadDeliveryFailuresRequiringAction(
  deps: SourceLeadCountDeps & { now?: () => Date } = {}
): Promise<DeliveryFailureRead> {
  const now = deps.now ?? (() => new Date());
  const read = await countSourceLeadsByStatus(
    SOURCE_INTAKE_DELIVERY_FAILED_STATUS,
    DELIVERY_INCOMPLETE,
    deps
  );
  if (read.state === "unavailable") return read;
  return { state: "ready", count: read.count, refreshedAt: now().toISOString() };
}
