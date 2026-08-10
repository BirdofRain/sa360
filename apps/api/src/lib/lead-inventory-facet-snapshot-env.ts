/**
 * Feature flags for Lead Inventory facets supply snapshot v1.
 * All flags default OFF — deploying this code must not change production behavior.
 */

function parseTruthyFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const asInt = Math.trunc(parsed);
  if (asInt < min || asInt > max) return fallback;
  return asInt;
}

/** When true, facets request path may read the active supply snapshot. Default: false. */
export function isLeadInventoryFacetSnapshotReadEnabled(): boolean {
  return parseTruthyFlag(process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_READ_ENABLED);
}

/**
 * When true, snapshot may be read for diagnostics/shadow comparison without
 * replacing the live response unless read is also enabled. Default: false.
 */
export function isLeadInventoryFacetSnapshotShadowEnabled(): boolean {
  return parseTruthyFlag(process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_SHADOW_ENABLED);
}

/** When true, worker may register the repeatable rebuild schedule. Default: false. */
export function isLeadInventoryFacetSnapshotRebuildEnabled(): boolean {
  return parseTruthyFlag(process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_ENABLED);
}

/** Rebuild cadence in minutes. Default 15; clamped to [5, 1440]. */
export function getLeadInventoryFacetSnapshotRebuildIntervalMinutes(): number {
  return parseBoundedInt(
    process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_REBUILD_INTERVAL_MINUTES,
    15,
    5,
    1440
  );
}

/**
 * Maximum age of an active snapshot that may still be served (minutes).
 * Default 30 (2× recommended 15-minute rebuild cadence). Clamped to [5, 1440].
 * Older snapshots fall back to the live aggregate path.
 */
export function getLeadInventoryFacetSnapshotMaxAgeMinutes(): number {
  return parseBoundedInt(
    process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES,
    30,
    5,
    1440
  );
}

/**
 * Soft stale warning threshold (minutes). Default = rebuild interval.
 * Snapshots older than this but within max age are served with a warning.
 */
export function getLeadInventoryFacetSnapshotStaleWarnMinutes(): number {
  return parseBoundedInt(
    process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES,
    getLeadInventoryFacetSnapshotRebuildIntervalMinutes(),
    5,
    1440
  );
}
