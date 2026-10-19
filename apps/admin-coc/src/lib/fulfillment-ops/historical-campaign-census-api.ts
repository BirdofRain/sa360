import "server-only";

import { adminFetchJson } from "@/lib/admin-api/server";
import {
  historicalCensusModelFromAdminFetch,
  historicalOrderModelFromAdminFetch,
  isHistoricalOrderNumber,
  type HistoricalCensusPanelModel,
  type HistoricalOrderPanelModel,
} from "@/lib/fulfillment-ops/historical-campaign-census";

const CENSUS_PATH = "/admin/v1/fulfillment-ops/historical-campaign-census";

/** Server-side read. The page calls this only after an operator asks for a snapshot. */
export async function loadHistoricalCampaignCensus(): Promise<HistoricalCensusPanelModel> {
  try {
    const result = await adminFetchJson<unknown>(CENSUS_PATH);
    return historicalCensusModelFromAdminFetch(result);
  } catch {
    return { state: "unavailable" };
  }
}

/** One order. Invalid numbers never reach the API. */
export async function loadHistoricalOrderDrilldown(orderNumber: string): Promise<HistoricalOrderPanelModel> {
  if (!isHistoricalOrderNumber(orderNumber)) return { state: "invalid" };
  try {
    const result = await adminFetchJson<unknown>(
      `/admin/v1/fulfillment-ops/historical-campaign-orders/${encodeURIComponent(orderNumber)}`
    );
    return historicalOrderModelFromAdminFetch(result, orderNumber);
  } catch {
    return { state: "unavailable" };
  }
}
