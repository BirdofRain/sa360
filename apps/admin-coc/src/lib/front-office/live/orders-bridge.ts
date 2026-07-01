import type { LeadOrder, LeadOrderStatus } from "../types";

export type ApiLeadOrderRow = {
  id: string;
  orderNumber: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  status: LeadOrderStatus;
  nicheKey: string;
  productType?: string | null;
  states: string[];
  leadVolume: number;
  deliveryCadence?: string | null;
  campaignType: string;
  crmPackage: string;
  aiVoiceAddon: boolean;
  requestedStartDate?: string | null;
  deliveryDestinationLabel: string | null;
  notes?: string | null;
  adminNotes?: string | null;
  setupWarnings?: string[];
  fulfillmentSummary?: string;
  routingRuleId?: string | null;
  campaignId?: string | null;
  createdAt: string;
  submittedAt?: string | null;
};

export function mapApiLeadOrderToFrontOffice(row: ApiLeadOrderRow): LeadOrder {
  const states = row.states?.length ? row.states : ["—"];
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    clientName: row.clientDisplayName ?? row.clientAccountId,
    clientAccountId: row.clientAccountId,
    niche: row.nicheKey,
    productType: row.productType ?? undefined,
    states,
    state: states.join(", "),
    volume: row.leadVolume,
    deliveryCadence: row.deliveryCadence ?? undefined,
    campaignType: row.campaignType,
    crmPackage: row.crmPackage,
    aiVoiceAddon: row.aiVoiceAddon,
    requestedStartDate: row.requestedStartDate ?? undefined,
    deliveryDestination: row.deliveryDestinationLabel ?? "—",
    notes: row.notes ?? undefined,
    adminNotes: row.adminNotes ?? undefined,
    status: row.status,
    adminStatus: row.status,
    setupWarnings: row.setupWarnings,
    fulfillmentSummary: row.fulfillmentSummary,
    routingRuleId: row.routingRuleId ?? undefined,
    campaignId: row.campaignId ?? undefined,
    leadDeliveryCount: undefined,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt ?? undefined,
  };
}

export function mapCreateInputToAdminBody(
  input: import("../types").CreateLeadOrderInput
): Record<string, unknown> {
  const states =
    input.states?.length > 0
      ? input.states
      : input.state
        ? [input.state]
        : [];
  return {
    clientAccountId: input.clientAccountId,
    clientDisplayName: input.clientName,
    nicheKey: input.niche,
    productType: input.productType,
    states,
    leadVolume: input.volume,
    deliveryCadence: input.deliveryCadence,
    campaignType: input.campaignType,
    crmPackage: input.crmPackage,
    aiVoiceAddon: input.aiVoiceAddon,
    requestedStartDate: input.requestedStartDate,
    deliveryDestinationLabel: input.deliveryDestination,
    notes: input.notes,
  };
}

export function mapCreateInputToClientBody(
  input: import("../types").CreateLeadOrderInput
): Record<string, unknown> {
  const adminBody = mapCreateInputToAdminBody(input);
  delete adminBody.clientAccountId;
  delete adminBody.clientDisplayName;
  return adminBody;
}

export type OrdersListFetchers = {
  fetchAdminList: (params: Record<string, string>) => Promise<{
    items: unknown[];
    error: string | null;
  }>;
  fetchClientList: (opts: {
    clientAccountId: string;
    status?: string;
    nicheKey?: string;
  }) => Promise<{ items: unknown[]; error: string | null }>;
};

export async function getLeadOrdersLiveWithFetchers(
  scope: import("./config").LiveBridgeScope,
  filters: { status?: string; nicheKey?: string; clientAccountId?: string },
  fetchers: OrdersListFetchers,
  opts: {
    liveEnabled: boolean;
    clientPortalConfigured: boolean;
  }
): Promise<import("../types").LeadOrdersResponse | null> {
  if (!opts.liveEnabled) return null;

  try {
    if (scope.role === "client" && scope.clientAccountId && opts.clientPortalConfigured) {
      const { items, error } = await fetchers.fetchClientList({
        clientAccountId: scope.clientAccountId,
        status: filters.status,
        nicheKey: filters.nicheKey,
      });
      if (error) return null;
      return {
        orders: (items as ApiLeadOrderRow[]).map(mapApiLeadOrderToFrontOffice),
        dataSource: items.length > 0 ? "live" : "partial_live",
      };
    }

    const params: Record<string, string> = {};
    if (filters.status) params.status = filters.status;
    if (filters.nicheKey) params.nicheKey = filters.nicheKey;
    if (filters.clientAccountId) params.clientAccountId = filters.clientAccountId;
    if (scope.role === "client" && scope.clientAccountId) {
      params.clientAccountId = scope.clientAccountId;
    }

    const { items, error } = await fetchers.fetchAdminList(params);
    if (error) return null;
    return {
      orders: (items as ApiLeadOrderRow[]).map(mapApiLeadOrderToFrontOffice),
      dataSource: items.length > 0 ? "live" : "partial_live",
    };
  } catch {
    return null;
  }
}

export async function getLeadOrdersWithFallback(
  scope: import("./config").LiveBridgeScope,
  filters: { status?: string; nicheKey?: string; clientAccountId?: string },
  fetchers: OrdersListFetchers,
  opts: {
    liveEnabled: boolean;
    clientPortalConfigured: boolean;
    mockOrders: import("../types").LeadOrdersResponse;
  }
): Promise<import("../types").LeadOrdersResponse> {
  const live = await getLeadOrdersLiveWithFetchers(scope, filters, fetchers, opts);
  if (live && live.orders.length > 0) return live;
  if (live && live.orders.length === 0) {
    return { orders: [], dataSource: live.dataSource };
  }
  return { ...opts.mockOrders, dataSource: "mock" };
}
