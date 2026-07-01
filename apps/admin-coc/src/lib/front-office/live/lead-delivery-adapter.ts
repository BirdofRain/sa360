import "server-only";

import {
  fetchAdminLeadDeliveryDetail,
  fetchAdminLeadDeliveryList,
  fetchAdminLeadTimeline,
  fetchAdminSourceLeadDetail,
  fetchAdminSourceLeads,
} from "@/lib/admin-api/server";

import {
  getMockLeadDeliveryDetail,
  getMockLeadDeliveryList,
} from "../mock/lead-delivery";
import type { LeadDeliveryDetail, LeadDeliveryListResponse } from "../types";
import type { LiveBridgeScope } from "./config";
import { isFrontOfficeLiveBridgeEnabled } from "./config";
import {
  getLeadDeliveryDetailLiveWithFetchers,
  getLeadDeliveryListLiveWithFetchers,
  type LeadDeliveryFetchers,
} from "./lead-delivery-bridge";

const fetchers: LeadDeliveryFetchers = {
  fetchUnifiedList: async (params) => {
    const { items, error } = await fetchAdminLeadDeliveryList(params);
    return { items, error };
  },
  fetchUnifiedDetail: async (id) => {
    const { item, error } = await fetchAdminLeadDeliveryDetail(id);
    return { item, error };
  },
  fetchLegacyList: async (params) => {
    const { items, error } = await fetchAdminSourceLeads(params);
    return { items, error };
  },
  fetchLegacyDetail: async (id) => {
    const { item, error } = await fetchAdminSourceLeadDetail(id);
    return { item, error };
  },
  fetchTimeline: async (params) => {
    const result = await fetchAdminLeadTimeline(params);
    return { timeline: result.timeline };
  },
};

export async function getLeadDeliveryListLive(
  scope: LiveBridgeScope
): Promise<LeadDeliveryListResponse | null> {
  if (!isFrontOfficeLiveBridgeEnabled(scope.role)) return null;
  try {
    return await getLeadDeliveryListLiveWithFetchers(scope, fetchers);
  } catch {
    return null;
  }
}

export async function getLeadDeliveryDetailLive(
  leadUid: string,
  scope: LiveBridgeScope
): Promise<LeadDeliveryDetail | null> {
  if (!isFrontOfficeLiveBridgeEnabled(scope.role)) return null;
  try {
    return await getLeadDeliveryDetailLiveWithFetchers(leadUid, scope, fetchers);
  } catch {
    return null;
  }
}

export async function getLeadDeliveryList(scope: LiveBridgeScope): Promise<LeadDeliveryListResponse> {
  const live = await getLeadDeliveryListLive(scope);
  if (live) return live;

  const mock = getMockLeadDeliveryList(scope.role);
  return { ...mock, dataSource: "mock" };
}

export async function getLeadDeliveryDetail(
  leadUid: string,
  scope: LiveBridgeScope
): Promise<LeadDeliveryDetail | null> {
  const live = await getLeadDeliveryDetailLive(leadUid, scope);
  if (live) return live;

  const mock = getMockLeadDeliveryDetail(leadUid);
  if (!mock) return null;
  if (
    scope.role === "client" &&
    scope.clientAccountId &&
    mock.clientAccountId &&
    mock.clientAccountId !== scope.clientAccountId
  ) {
    return null;
  }
  if (scope.role === "client" && mock.matchedClient !== "Summit Insurance Group") {
    return null;
  }
  return mock;
}

export async function getLeadDeliveryListWithFallback(
  scope: LiveBridgeScope
): Promise<LeadDeliveryListResponse> {
  const live = await getLeadDeliveryListLive(scope);
  const mock = getMockLeadDeliveryList(scope.role);
  if (live && live.rows.length > 0) {
    return live;
  }
  if (live && live.rows.length === 0) {
    return { rows: [], dataSource: live.dataSource };
  }
  return { ...mock, dataSource: "mock" };
}

export function mergeLeadDeliveryDataSource(
  live: LeadDeliveryListResponse | null,
  mock: LeadDeliveryListResponse
): LeadDeliveryListResponse {
  if (!live) return { ...mock, dataSource: "mock" };
  if (live.rows.length === 0) return { rows: [], dataSource: live.dataSource };
  return live;
}

export { resolveDataSource } from "./data-source";
