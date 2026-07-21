export type {
  GetInventorySnapshotInput,
  InventoryExplorerReadModel,
  InventoryNicheKey,
  InventoryNicheSummary,
  InventorySnapshotFallbackStatus,
  InventorySnapshotFreshness,
  InventorySnapshotProvider,
  InventorySnapshotProvenance,
  InventorySnapshotSource,
  NormalizedInventorySnapshot,
} from "@sa360/shared";

export const INVENTORY_CACHE_KEY_PREFIX = "inventory-explorer:snapshot:v1:";

export function inventoryCacheKey(nicheKey: string): string {
  return `${INVENTORY_CACHE_KEY_PREFIX}${nicheKey}`;
}
