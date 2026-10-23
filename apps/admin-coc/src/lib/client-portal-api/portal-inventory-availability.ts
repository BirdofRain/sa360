import "server-only";

import type { CommerceAgeBucketKey } from "@sa360/shared";

import { loadPortalBuyerMapAvailability } from "../client-portal/portal-buyer-map.ts";
import type { PortalBuyerMapLoadResult } from "../client-portal/portal-buyer-map.ts";
import { resolvePortalOrderCreateEligibility } from "./portal-order-create.ts";
import { fetchPortalBuyerInventorySnapshot } from "./server.ts";

export async function loadPortalInventoryAvailability(input: {
  clientAccountId: string;
  nicheKey: string;
  requestedAgeBucket: CommerceAgeBucketKey;
  requestedQuantity: number;
}): Promise<PortalBuyerMapLoadResult> {
  const eligibility = await resolvePortalOrderCreateEligibility({
    clientAccountId: input.clientAccountId,
  });
  if (!eligibility.ok) {
    return {
      ok: false,
      status: eligibility.status,
      error: eligibility.error,
    };
  }
  return loadPortalBuyerMapAvailability({
    ...input,
    fetchSnapshot: fetchPortalBuyerInventorySnapshot,
  });
}
