import "server-only";

import { getInventoryExplorerFixture } from "./inventory-fixtures";
import type { InventoryExplorerReadModel } from "./inventory-types";

/**
 * Fixture-only getter for Inventory Explorer (route still under pipeline-studio).
 * Future: replace with one authenticated aggregate read API — no writes.
 */
export async function getPipelineStudioReadModel(): Promise<InventoryExplorerReadModel> {
  return getInventoryExplorerFixture();
}

export async function getInventoryExplorerReadModel(): Promise<InventoryExplorerReadModel> {
  return getInventoryExplorerFixture();
}
