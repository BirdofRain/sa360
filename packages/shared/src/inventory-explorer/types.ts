/**
 * Shared Inventory Explorer contracts (read-only aggregate snapshots).
 * No reservation, order, or quote write capabilities.
 */

export type {
  AgeBucketKey,
  AggregateBucketTotals,
  AggregateGeographyRow,
  GeographyClassification,
  InventoryReportValidation,
  LeadProcessorReportMetadata,
  ReportCompleteness,
} from "./inventory-report-parser.js";

import type { AgeBucketKey } from "./inventory-report-parser.js";

export type InventoryNicheKey = "TRUCKER" | "VET";

export type TimezoneKey = "Eastern" | "Central" | "Mountain" | "Pacific";

export type TimezoneStatus = "single" | "mixed";

export type StateDataStatus = "known" | "unknown";

export type InventorySnapshotSource =
  | "google_sheets"
  | "cached_google_sheets"
  | "fixture_csv";

export type InventorySnapshotFreshness =
  | "fresh"
  | "stale"
  | "fallback"
  | "invalid";

export type InventorySnapshotFallbackStatus =
  | "none"
  | "used_cache"
  | "used_fixture"
  | "sheets_unavailable"
  | "sheets_invalid";

export type InventorySnapshotProvenance = {
  source: InventorySnapshotSource;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  freshness: InventorySnapshotFreshness;
  fallbackStatus: InventorySnapshotFallbackStatus;
  validationWarnings: string[];
};

export type TopStateIndicator = {
  stateCode: string;
  stateName: string;
  value: number;
};

export type UnmappedGeography = {
  code: string;
  countsByAgeBucket: Record<AgeBucketKey, number>;
  totalAvailable: number;
};

export type InventorySnapshot = {
  reportVersion: string;
  nicheKey: InventoryNicheKey;
  sourceSheet: string;
  generatedAt: string;
  completedAt: string;
  sourceRowsAvailable: number;
  rowsScanned: number;
  completeness: import("./inventory-report-parser.js").ReportCompleteness;
  publishedTotals: import("./inventory-report-parser.js").AggregateBucketTotals;
  mappedTotals: import("./inventory-report-parser.js").AggregateBucketTotals;
  unmappedTotals: import("./inventory-report-parser.js").AggregateBucketTotals;
  mappedGeographyCount: number;
  unmappedGeographyCount: number;
  warnings: string[];
  validationErrors: string[];
  reconciledNationalTotals: boolean;
  reportLabel: string;
  isPartialReport: boolean;
  snapshotUnverified: boolean;
  topInventoryState: TopStateIndicator | null;
  strongestByAgeBucket: Record<AgeBucketKey, TopStateIndicator | null>;
};

export type NicheOption = {
  key: InventoryNicheKey;
  label: string;
};

export type AgeBucketOption = {
  key: AgeBucketKey;
  label: string;
};

export const AGE_BUCKET_OPTIONS: AgeBucketOption[] = [
  { key: "1_3", label: "1–3 months" },
  { key: "3_6", label: "3–6 months" },
  { key: "6_plus", label: "6+ months" },
];

export const AVAILABLE_TIMEZONES: TimezoneKey[] = [
  "Eastern",
  "Central",
  "Mountain",
  "Pacific",
];

export const NICHE_LABELS: Record<InventoryNicheKey, string> = {
  TRUCKER: "Truckers",
  VET: "VET",
};

export type InventoryStateRecord = {
  stateCode: string;
  stateName: string;
  timezones: TimezoneKey[];
  timezoneStatus: TimezoneStatus;
  countsByAgeBucket: Record<AgeBucketKey, number>;
  dataStatus: StateDataStatus;
};

export type InventoryExplorerCapabilities = {
  canCreateOrder: false;
  canReserveInventory: false;
  canRequestQuote: false;
  canReviewAdditionalInventory: boolean;
};

export type InventoryNicheBundle = {
  nicheKey: InventoryNicheKey;
  label: string;
  snapshot: InventorySnapshot;
  states: InventoryStateRecord[];
  unmappedGeographies: UnmappedGeography[];
};

export type InventoryFilters = {
  nicheKey: InventoryNicheKey;
  selectedAgeBuckets: AgeBucketKey[];
  selectedTimezone: TimezoneKey | null;
  requestedQuantity: number;
};

/** Normalized API/UI read model for Inventory Explorer. */
export type InventoryExplorerReadModel = {
  dataSource: "mock" | "live";
  availableNiches: NicheOption[];
  availableAgeBuckets: AgeBucketOption[];
  availableTimezones: TimezoneKey[];
  niches: Record<InventoryNicheKey, InventoryNicheBundle>;
  defaultFilters: InventoryFilters;
  capabilities: InventoryExplorerCapabilities;
  provenance: InventorySnapshotProvenance;
};

export type InventoryNicheSummary = {
  key: InventoryNicheKey;
  label: string;
};

/** Per-niche snapshot result from a provider (before full read-model assemble). */
export type NormalizedInventorySnapshot = {
  nicheKey: InventoryNicheKey;
  bundle: InventoryNicheBundle;
  provenance: InventorySnapshotProvenance;
  /** True when the payload may be written to the valid-snapshot cache. */
  cacheEligible: boolean;
};
