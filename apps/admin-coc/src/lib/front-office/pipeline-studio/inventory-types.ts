/**
 * Authoritative Inventory Explorer read model.
 * Fixture-only — no inventory reservation or order creation.
 */

import type {
  AggregateBucketTotals,
  ReportCompleteness,
} from "./inventory-report-parser";

export type { AggregateBucketTotals, ReportCompleteness };

export const INVENTORY_EXPLORER_SAFETY_LINE =
  "No inventory is reserved and no order is created from this screen.";

/** @deprecated Prefer INVENTORY_EXPLORER_SAFETY_LINE in compact UI. */
export const INVENTORY_EXPLORER_NOTICE =
  `Inventory preview using aggregate snapshot data. ${INVENTORY_EXPLORER_SAFETY_LINE}`;

export const UNMAPPED_GEOGRAPHY_DISCLOSURE =
  "Some source records use geography codes outside the supported 50-state + DC map. They are included in report totals but excluded from state availability shading.";

export type AgeBucketKey = "1_3" | "3_6" | "6_plus";

export type InventoryNicheKey = "TRUCKER" | "VET";

export type TimezoneKey = "Eastern" | "Central" | "Mountain" | "Pacific";

export type TimezoneStatus = "single" | "mixed";

export type StateDataStatus = "known" | "unknown";

export type FulfillmentStatus =
  | "strong"
  | "available"
  | "partial"
  | "custom_review"
  | "unavailable"
  | "unknown";

export type RelativeVolumeBand =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "very_high"
  | "unknown";

export type InventoryFilters = {
  nicheKey: InventoryNicheKey;
  selectedAgeBuckets: AgeBucketKey[];
  selectedTimezone: TimezoneKey | null;
  requestedQuantity: number;
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
  completeness: ReportCompleteness;
  publishedTotals: AggregateBucketTotals;
  mappedTotals: AggregateBucketTotals;
  unmappedTotals: AggregateBucketTotals;
  mappedGeographyCount: number;
  unmappedGeographyCount: number;
  warnings: string[];
  validationErrors: string[];
  reconciledNationalTotals: boolean;
  reportLabel: string;
  /** @deprecated prefer completeness */
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

export type InventoryExplorerReadModel = {
  dataSource: "mock";
  availableNiches: NicheOption[];
  availableAgeBuckets: AgeBucketOption[];
  availableTimezones: TimezoneKey[];
  niches: Record<InventoryNicheKey, InventoryNicheBundle>;
  defaultFilters: InventoryFilters;
  capabilities: InventoryExplorerCapabilities;
};

export type DerivedStateInventory = InventoryStateRecord & {
  filteredAvailable: number;
  relativeVolumeBand: RelativeVolumeBand;
  fulfillmentRatio: number;
  fulfillmentStatus: FulfillmentStatus;
  fullOrdersPossible: number;
  customQuoteEligible: boolean;
  selected: boolean;
};

export type InventoryExplorerDerived = {
  filters: InventoryFilters;
  activeNiche: InventoryNicheBundle;
  states: DerivedStateInventory[];
  rankedStates: DerivedStateInventory[];
  kpis: {
    totalMatching: number;
    statesWithInventory: number;
    statesThatCanFulfill: number;
    estimatedShortfall: number;
    snapshotFreshnessLabel: string;
    knownStates: number;
    unknownStates: number;
    unmappedInventoryTotal: number;
  };
};
