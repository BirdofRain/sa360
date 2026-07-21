import type {
  InventoryNicheKey,
  InventoryNicheSummary,
  NormalizedInventorySnapshot,
} from "./types.js";

export type GetInventorySnapshotInput = {
  nicheKey: InventoryNicheKey;
  forceRefresh?: boolean;
};

/**
 * Provider-agnostic inventory snapshot contract.
 * Implementations must remain read-only (no Sheets writes, no inventory mutations).
 */
export interface InventorySnapshotProvider {
  getAvailableNiches(): Promise<InventoryNicheSummary[]>;
  getSnapshot(
    input: GetInventorySnapshotInput
  ): Promise<NormalizedInventorySnapshot>;
}

export const INVENTORY_SNAPSHOT_PROVIDER_KINDS = [
  "file",
  "google_sheets",
  "composited",
] as const;

export type InventorySnapshotProviderKind =
  (typeof INVENTORY_SNAPSHOT_PROVIDER_KINDS)[number];
