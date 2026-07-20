import type {
  AgeBucketKey,
  InventoryExplorerReadModel,
  InventoryStateRecord,
} from "./inventory-types";
import { STATE_TIMEZONE_META } from "./state-timezone-meta";

/**
 * Partial Truckers inventory fixture (report v5.0.0).
 * Source CSV: docs/demo/inventory/trucker-inventory-2026-07-17.csv
 * Only NC and VA state rows are present — all other states are UNKNOWN
 * (never treated as zero inventory).
 */
const KNOWN_COUNTS: Record<
  string,
  Record<AgeBucketKey, number>
> = {
  NC: { "1_3": 16, "3_6": 23, "6_plus": 134 },
  VA: { "1_3": 7, "3_6": 20, "6_plus": 221 },
};

const EMPTY_BUCKETS: Record<AgeBucketKey, number> = {
  "1_3": 0,
  "3_6": 0,
  "6_plus": 0,
};

function buildStates(): InventoryStateRecord[] {
  return Object.entries(STATE_TIMEZONE_META)
    .map(([stateCode, meta]) => {
      const known = KNOWN_COUNTS[stateCode];
      return {
        stateCode,
        stateName: meta.stateName,
        timezones: meta.timezones,
        timezoneStatus: meta.timezoneStatus,
        countsByAgeBucket: known
          ? { ...known }
          : { ...EMPTY_BUCKETS },
        dataStatus: known ? ("known" as const) : ("unknown" as const),
      };
    })
    .sort((a, b) => a.stateCode.localeCompare(b.stateCode));
}

export const INVENTORY_EXPLORER_FIXTURE: InventoryExplorerReadModel = {
  dataSource: "mock",
  snapshot: {
    generatedAt: "2026-07-17T12:00:00.000Z",
    completedAt: "2026-07-17T23:59:59.000Z",
    sourceSheet: "Truckers",
    reportVersion: "5.0.0",
    sourceRowsAvailable: 28495,
    rowsScanned: 28495,
    totalAvailable: 267 + 1415 + 8621,
    excludedCounts: 0,
    isPartialReport: true,
    reportLabel: "Truckers aggregate snapshot v5.0.0 (PARTIAL — NC & VA only)",
  },
  availableNiches: [
    { key: "truckers", label: "Truckers" },
    /** No state rows in this fixture — used to exercise niche filtering. */
    { key: "homeowners", label: "Homeowners (no snapshot rows)" },
  ],
  availableAgeBuckets: [
    { key: "1_3", label: "1–3 months" },
    { key: "3_6", label: "3–6 months" },
    { key: "6_plus", label: "6+ months" },
  ],
  availableTimezones: ["Eastern", "Central", "Mountain", "Pacific"],
  defaultFilters: {
    nicheKey: "truckers",
    selectedAgeBuckets: ["6_plus"],
    selectedTimezone: null,
    requestedQuantity: 100,
  },
  states: buildStates(),
  capabilities: {
    canCreateOrder: false,
    canReserveInventory: false,
    canRequestQuote: false,
    canReviewAdditionalInventory: true,
    showRoutingPrototype: false,
  },
};

/** National age totals from the report header (for display / sanity checks). */
export const NATIONAL_AGE_TOTALS: Record<AgeBucketKey, number> = {
  "1_3": 267,
  "3_6": 1415,
  "6_plus": 8621,
};

export function getInventoryExplorerFixture(): InventoryExplorerReadModel {
  return structuredClone(INVENTORY_EXPLORER_FIXTURE);
}
