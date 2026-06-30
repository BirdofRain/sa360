import "server-only";

import { adminFetchJson, isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  adaptLeadFulfillmentOverviewApiResponse,
  type LeadFulfillmentOverviewApiResponse,
} from "@/lib/lead-fulfillment/lead-fulfillment-adapters";
import { getLeadFulfillmentOverviewData } from "@/lib/lead-fulfillment/mock-overview-data";
import type { LeadFulfillmentOverviewData } from "@/lib/lead-fulfillment/types";

export type { LeadFulfillmentOverviewApiResponse } from "@/lib/lead-fulfillment/lead-fulfillment-adapters";
export {
  adaptLeadFulfillmentOverviewApiResponse,
  hasLimitedLf1ModuleKpis,
} from "@/lib/lead-fulfillment/lead-fulfillment-adapters";

export type LeadFulfillmentPageLoadResult = {
  data: LeadFulfillmentOverviewData;
  dataSource: "live" | "mock";
  loadError: string | null;
  dataLimitations: string[];
};

function formatLoadError(status: number, body: string): string {
  if (status === 0) return body;
  const snippet = body.length > 280 ? `${body.slice(0, 280)}…` : body;
  return `Admin API error (${status}): ${snippet}`;
}

export async function loadLeadFulfillmentOverviewPageData(): Promise<LeadFulfillmentPageLoadResult> {
  if (!isAdminApiConfigured()) {
    return {
      data: getLeadFulfillmentOverviewData(),
      dataSource: "mock",
      loadError: "Admin API is not configured for this app.",
      dataLimitations: [],
    };
  }

  const res = await adminFetchJson<LeadFulfillmentOverviewApiResponse>(
    "/admin/v1/coc/lead-fulfillment/overview"
  );

  if (!res.ok) {
    return {
      data: getLeadFulfillmentOverviewData(),
      dataSource: "mock",
      loadError: formatLoadError(res.status, res.body),
      dataLimitations: [],
    };
  }

  return {
    data: adaptLeadFulfillmentOverviewApiResponse(res.data),
    dataSource: "live",
    loadError: null,
    dataLimitations: res.data.dataLimitations ?? [],
  };
}
