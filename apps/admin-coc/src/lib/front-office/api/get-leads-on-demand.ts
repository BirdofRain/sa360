import "server-only";

import { fetchClientLeadsOnDemandAvailability } from "@/lib/client-portal-api/server";
import type { FrontOfficeRole, FrontOfficeDataSource } from "../types";

export type ClientLeadsOnDemandAvailabilityResult = {
  rows: Array<{
    nicheKey: string;
    productType: string | null;
    state: string;
    ageBandLabel: string;
    inventoryClass: string;
    exclusivityMode: string;
    availabilityLabel: "Available" | "Limited" | "Currently unavailable";
    unitPriceCents: number | null;
    evaluatedAt: string;
  }>;
  evaluatedAt: string | null;
  dataSource: FrontOfficeDataSource;
  error: string | null;
};

export async function getLeadsOnDemandAvailability(
  role: FrontOfficeRole,
  opts: { clientAccountId?: string; nicheKey?: string; productType?: string }
): Promise<ClientLeadsOnDemandAvailabilityResult> {
  if (!opts.clientAccountId) {
    return {
      rows: [],
      evaluatedAt: null,
      dataSource: "mock",
      error: "Client account scope required",
    };
  }

  const result = await fetchClientLeadsOnDemandAvailability({
    clientAccountId: opts.clientAccountId,
    nicheKey: opts.nicheKey,
    productType: opts.productType,
  });

  return {
    rows: result.rows,
    evaluatedAt: result.evaluatedAt,
    dataSource: result.dataSource === "live" ? "live" : "mock",
    error: result.error,
  };
}
