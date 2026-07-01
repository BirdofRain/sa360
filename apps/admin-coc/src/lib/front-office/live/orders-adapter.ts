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
): Promise<LeadOrder | null> {
  if (!isFrontOfficeLiveBridgeEnabled(scope.role)) return null;

  try {
    if (scope.role === "client" && scope.clientAccountId && isClientPortalApiConfigured()) {
      const { item, error } = await fetchers.createClient({
        clientAccountId: scope.clientAccountId,
        body: mapCreateInputToClientBody(input),
      });
      if (error || !item) return null;
      return mapApiLeadOrderToFrontOffice(item as ApiLeadOrderRow);
    }

    if (scope.role === "admin") {
      const body = mapCreateInputToAdminBody(input);
      if (!body.clientAccountId) {
        body.clientAccountId = input.clientAccountId ?? "unassigned";
      }
      const { item, error } = await fetchers.createAdmin({ body });
      if (error || !item) return null;
      return mapApiLeadOrderToFrontOffice(item as ApiLeadOrderRow);
    }
  } catch {
    return null;
  }
  return null;
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
