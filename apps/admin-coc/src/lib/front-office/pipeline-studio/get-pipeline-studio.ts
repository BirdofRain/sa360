import "server-only";

import type { InventoryExplorerReadModel } from "./inventory-types";
import { getInventoryExplorerWithFallback } from "./live/inventory-explorer-adapter";

/**
 * Inventory Explorer getter (route still under pipeline-studio).
 * Uses authenticated aggregate read API when configured; fixture fallback otherwise.
 * No inventory writes.
 */
export async function getPipelineStudioReadModel(): Promise<InventoryExplorerReadModel> {
  return getInventoryExplorerWithFallback();
}

export async function getInventoryExplorerReadModel(): Promise<InventoryExplorerReadModel> {
  return getInventoryExplorerWithFallback();
}
