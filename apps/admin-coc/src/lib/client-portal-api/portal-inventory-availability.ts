import "server-only";

import type { CommerceAgeBucketRequestKey } from "@sa360/shared";

import { loadPortalBuyerMapAvailability } from "../client-portal/portal-buyer-map.ts";
import type { PortalBuyerMapLoadResult } from "../client-portal/portal-buyer-map.ts";
import { fetchPortalBuyerInventorySnapshot } from "./server.ts";

export async function loadPortalInventoryAvailability(input: {
  clientAccountId: string;
  nicheKey: string;
  requestedAgeBucket: CommerceAgeBucketRequestKey;
  requestedQuantity: number;
}): Promise<PortalBuyerMapLoadResult> {
  return loadPortalBuyerMapAvailability({
    ...input,
    fetchSnapshot: fetchPortalBuyerInventorySnapshot,
  });
}
