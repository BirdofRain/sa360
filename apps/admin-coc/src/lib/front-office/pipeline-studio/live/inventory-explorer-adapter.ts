import "server-only";

import { adminFetchJson, isAdminApiConfigured } from "@/lib/admin-api/server";

import { getInventoryExplorerFixture } from "../inventory-fixtures";
import type { InventoryExplorerReadModel } from "../inventory-types";

type InventoryExplorerApiResponse = InventoryExplorerReadModel & {
  ok?: boolean;
};

function looksLikeReadModel(
  value: unknown
): value is InventoryExplorerReadModel {
  if (!value || typeof value !== "object") return false;
  const v = value as InventoryExplorerReadModel;
  return Boolean(
    v.niches?.TRUCKER &&
      v.niches?.VET &&
      v.capabilities &&
      v.provenance &&
      v.availableNiches
  );
}

/**
 * Prefer authenticated aggregate API when configured; otherwise committed fixtures.
 * Never enables inventory mutations.
 */
export async function getInventoryExplorerWithFallback(): Promise<InventoryExplorerReadModel> {
  if (!isAdminApiConfigured()) {
    return getInventoryExplorerFixture();
  }

  const res = await adminFetchJson<InventoryExplorerApiResponse>(
    "/admin/v1/front-office/inventory-explorer"
  );

  if (!res.ok || !looksLikeReadModel(res.data)) {
    return getInventoryExplorerFixture();
  }

  const model = res.data;
  // Safety: never accept write-capable payloads from the API.
  if (
    model.capabilities.canCreateOrder !== false ||
    model.capabilities.canReserveInventory !== false ||
    model.capabilities.canRequestQuote !== false
  ) {
    return getInventoryExplorerFixture();
  }

  return {
    ...model,
    capabilities: {
      canCreateOrder: false,
      canReserveInventory: false,
      canRequestQuote: false,
      canReviewAdditionalInventory:
        model.capabilities.canReviewAdditionalInventory ?? true,
    },
  };
}
