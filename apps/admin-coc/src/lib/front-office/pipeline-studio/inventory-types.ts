/**
 * Authoritative Inventory Explorer read model.
 * Fixture-only in this slice — no inventory reservation or order creation.
 */

export const INVENTORY_EXPLORER_NOTICE =
  "Inventory preview using aggregate snapshot data. No inventory is reserved and no order is created from this screen.";

export type AgeBucketKey = "1_3" | "3_6" | "6_plus";

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

export type RelativeVolumeBand = "none" | "low" | "medium" | "high" | "very_high" | "unknown";

export type InventoryFilters = {
  nicheKey: string;
  selectedAgeBuckets: AgeBucketKey[];
  selectedTimezone: TimezoneKey | null;
  requestedQuantity: number;
};

export type InventorySnapshot = {
  generatedAt: string;
  completedAt: string;
  sourceSheet: string;
  reportVersion: string;
  sourceRowsAvailable: number;
  rowsScanned: number;
  totalAvailable: number;
  excludedCounts: number;
  /** True when the CSV/fixture does not include every state row. */
  isPartialReport: boolean;
  reportLabel: string;
};

export type NicheOption = {
  key: string;
  label: string;
};

export type AgeBucketOption = {
  key: AgeBucketKey;
  label: string;
};

export type InventoryStateRecord = {
  stateCode: string;
  stateName: string;
  timezones: TimezoneKey[];
  timezoneStatus: TimezoneStatus;
  /** Absolute age-bucket counts when known; omitted/zeroed when unknown. */
  countsByAgeBucket: Record<AgeBucketKey, number>;
  dataStatus: StateDataStatus;
};

export type InventoryExplorerCapabilities = {
  canCreateOrder: false;
  canReserveInventory: false;
  canRequestQuote: false;
  canReviewAdditionalInventory: boolean;
  /** Routing/designer prototype remains in source but is not rendered. */
  showRoutingPrototype: false;
};

export type InventoryExplorerReadModel = {
  dataSource: "mock";
  snapshot: InventorySnapshot;
  availableNiches: NicheOption[];
  availableAgeBuckets: AgeBucketOption[];
  availableTimezones: TimezoneKey[];
  defaultFilters: InventoryFilters;
  states: InventoryStateRecord[];
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
  states: DerivedStateInventory[];
  kpis: {
    totalMatching: number;
    statesWithInventory: number;
    statesThatCanFulfill: number;
    estimatedShortfall: number;
    snapshotFreshnessLabel: string;
  };
};
