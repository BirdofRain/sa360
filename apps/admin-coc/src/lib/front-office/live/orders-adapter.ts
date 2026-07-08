import "server-only";

import {
  createAdminLeadOrder,
  fetchAdminLeadOrderDetail,
  fetchAdminLeadOrdersList,
  patchAdminLeadOrder,
} from "@/lib/admin-api/server";
import {
  createClientLeadOrder,
  fetchClientLeadOrdersList,
  isClientPortalApiConfigured,
} from "@/lib/client-portal-api/server";

import { getMockOrders } from "../mock/orders";
import type {
  CreateLeadOrderInput,
  LeadOrder,
  LeadOrdersResponse,
  UpdateLeadOrderInput,
} from "../types";
import type { LiveBridgeScope } from "./config";
import { isFrontOfficeLiveBridgeEnabled } from "./config";
import { resolveDataSource } from "./data-source";
import {
  getLeadOrdersLiveWithFetchers as getLeadOrdersLiveCore,
  getLeadOrdersWithFallback as getLeadOrdersWithFallbackCore,
  mapApiLeadOrderToFrontOffice,
  mapCreateInputToAdminBody,
  mapCreateInputToClientBody,
  type ApiLeadOrderRow,
  type OrdersListFetchers,
} from "./orders-bridge";

export type OrdersFetchers = OrdersListFetchers & {
  fetchAdminDetail: typeof fetchAdminLeadOrderDetail;
  createAdmin: typeof createAdminLeadOrder;
  patchAdmin: typeof patchAdminLeadOrder;
  createClient: typeof createClientLeadOrder;
};

export type CreateLeadOrderLiveResult =
  | { ok: true; order: LeadOrder }
  | {
      ok: false;
      code:
        | "live_bridge_disabled"
        | "client_portal_not_configured"
        | "missing_client_account_id"
        | "invalid_role"
        | "live_create_failed";
      error: string;
    };

const defaultFetchers: OrdersFetchers = {
  fetchAdminList: fetchAdminLeadOrdersList,
  fetchAdminDetail: fetchAdminLeadOrderDetail,
  createAdmin: createAdminLeadOrder,
  patchAdmin: patchAdminLeadOrder,
  fetchClientList: fetchClientLeadOrdersList,
  createClient: createClientLeadOrder,
};

function bridgeOpts(scope: LiveBridgeScope) {
  return {
    liveEnabled: isFrontOfficeLiveBridgeEnabled(scope.role),
    clientPortalConfigured: isClientPortalApiConfigured(),
    mockOrders: getMockOrders(scope.role),
  };
}

export async function getLeadOrdersLiveWithFetchers(
  scope: LiveBridgeScope,
  filters: { status?: string; nicheKey?: string; clientAccountId?: string } = {},
  fetchers: OrdersListFetchers = defaultFetchers
): Promise<LeadOrdersResponse | null> {
  return getLeadOrdersLiveCore(scope, filters, fetchers, bridgeOpts(scope));
}

export async function getLeadOrdersWithFallback(
  scope: LiveBridgeScope,
  filters: { status?: string; nicheKey?: string; clientAccountId?: string } = {},
  fetchers: OrdersListFetchers = defaultFetchers
): Promise<LeadOrdersResponse> {
  const opts = bridgeOpts(scope);
  return getLeadOrdersWithFallbackCore(scope, filters, fetchers, opts);
}

export async function createLeadOrderLive(
  input: CreateLeadOrderInput,
  scope: LiveBridgeScope,
  fetchers: OrdersFetchers = defaultFetchers
): Promise<CreateLeadOrderLiveResult> {
  if (!isFrontOfficeLiveBridgeEnabled(scope.role)) {
    return {
      ok: false,
      code: "live_bridge_disabled",
      error: `Live front-office bridge is disabled for role ${scope.role}.`,
    };
  }

  try {
    if (scope.role === "client" && !scope.clientAccountId) {
      return {
        ok: false,
        code: "missing_client_account_id",
        error: "Client session is missing clientAccountId.",
      };
    }

    if (scope.role === "client" && !isClientPortalApiConfigured()) {
      return {
        ok: false,
        code: "client_portal_not_configured",
        error: "Client portal API is not configured.",
      };
    }

    if (scope.role === "client" && scope.clientAccountId && isClientPortalApiConfigured()) {
      const { item, error } = await fetchers.createClient({
        clientAccountId: scope.clientAccountId,
        body: mapCreateInputToClientBody(input),
      });
      if (error || !item) {
        return {
          ok: false,
          code: "live_create_failed",
          error: error ?? "Client live order create returned no item.",
        };
      }
      return { ok: true, order: mapApiLeadOrderToFrontOffice(item as ApiLeadOrderRow) };
    }

    if (scope.role === "admin") {
      const body = mapCreateInputToAdminBody(input);
      if (!body.clientAccountId) {
        body.clientAccountId = input.clientAccountId ?? "unassigned";
      }
      const { item, error } = await fetchers.createAdmin({ body });
      if (error || !item) {
        return {
          ok: false,
          code: "live_create_failed",
          error: error ?? "Admin live order create returned no item.",
        };
      }
      return { ok: true, order: mapApiLeadOrderToFrontOffice(item as ApiLeadOrderRow) };
    }
  } catch (err) {
    return {
      ok: false,
      code: "live_create_failed",
      error: err instanceof Error ? err.message : "Live order create threw an unexpected error.",
    };
  }
  return {
    ok: false,
    code: "invalid_role",
    error: `Role ${scope.role} cannot create lead orders.`,
  };
}

export async function updateLeadOrderLive(
  id: string,
  input: UpdateLeadOrderInput,
  fetchers: OrdersFetchers = defaultFetchers
): Promise<LeadOrder | null> {
  if (!isFrontOfficeLiveBridgeEnabled("admin")) return null;
  try {
    const { item, error } = await fetchers.patchAdmin({ id, body: input });
    if (error || !item) return null;
    return mapApiLeadOrderToFrontOffice(item as ApiLeadOrderRow);
  } catch {
    return null;
  }
}

export { resolveDataSource };
