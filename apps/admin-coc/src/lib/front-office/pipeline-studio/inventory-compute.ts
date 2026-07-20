import type {
  AgeBucketKey,
  DerivedStateInventory,
  FulfillmentStatus,
  InventoryExplorerDerived,
  InventoryExplorerReadModel,
  InventoryFilters,
  InventoryNicheKey,
  RelativeVolumeBand,
  TimezoneKey,
} from "./inventory-types";
import { AGE_BUCKET_OPTIONS } from "./inventory-types";

export const MIN_REQUESTED_QUANTITY = 1;
export const MAX_REQUESTED_QUANTITY = 5000;

export function clampRequestedQuantity(value: number): number {
  if (!Number.isFinite(value)) return MIN_REQUESTED_QUANTITY;
  return Math.min(
    MAX_REQUESTED_QUANTITY,
    Math.max(MIN_REQUESTED_QUANTITY, Math.floor(value))
  );
}

export function filteredAvailableForState(
  countsByAgeBucket: Record<AgeBucketKey, number>,
  selectedAgeBuckets: AgeBucketKey[],
  dataStatus: "known" | "unknown"
): number {
  if (dataStatus === "unknown") return 0;
  const buckets =
    selectedAgeBuckets.length > 0
      ? selectedAgeBuckets
      : (Object.keys(countsByAgeBucket) as AgeBucketKey[]);
  return buckets.reduce((sum, key) => sum + (countsByAgeBucket[key] ?? 0), 0);
}

export function computeFulfillmentStatus(
  filteredAvailable: number,
  requestedQuantity: number,
  dataStatus: "known" | "unknown"
): FulfillmentStatus {
  if (dataStatus === "unknown") return "unknown";
  const qty = clampRequestedQuantity(requestedQuantity);
  if (filteredAvailable <= 0) return "unavailable";
  if (filteredAvailable >= qty * 2) return "strong";
  if (filteredAvailable >= qty) return "available";
  if (filteredAvailable >= qty * 0.25) return "partial";
  return "custom_review";
}

export function computeFullOrdersPossible(
  filteredAvailable: number,
  requestedQuantity: number,
  dataStatus: "known" | "unknown"
): number {
  if (dataStatus === "unknown") return 0;
  const qty = clampRequestedQuantity(requestedQuantity);
  return Math.floor(filteredAvailable / qty);
}

function volumeBand(
  filteredAvailable: number,
  dataStatus: "known" | "unknown",
  maxKnown: number
): RelativeVolumeBand {
  if (dataStatus === "unknown") return "unknown";
  if (filteredAvailable <= 0) return "none";
  if (maxKnown <= 0) return "low";
  const ratio = filteredAvailable / maxKnown;
  if (ratio >= 0.75) return "very_high";
  if (ratio >= 0.45) return "high";
  if (ratio >= 0.2) return "medium";
  return "low";
}

function matchesTimezone(
  stateTimezones: TimezoneKey[],
  selected: TimezoneKey | null
): boolean {
  if (!selected) return true;
  return stateTimezones.includes(selected);
}

function resolveNicheKey(
  model: InventoryExplorerReadModel,
  nicheKey: InventoryNicheKey
): InventoryNicheKey {
  if (model.niches[nicheKey]) return nicheKey;
  return model.defaultFilters.nicheKey;
}

/** Rank: known first, then by filteredAvailable desc (zeros below positives), unknowns last. */
export function rankInventoryStates(
  states: DerivedStateInventory[]
): DerivedStateInventory[] {
  return [...states].sort((a, b) => {
    if (a.dataStatus !== b.dataStatus) {
      return a.dataStatus === "known" ? -1 : 1;
    }
    if (a.filteredAvailable !== b.filteredAvailable) {
      return b.filteredAvailable - a.filteredAvailable;
    }
    return a.stateCode.localeCompare(b.stateCode);
  });
}

export function deriveInventoryExplorer(
  model: InventoryExplorerReadModel,
  filters: InventoryFilters,
  selectedStateCodes: Set<string>
): InventoryExplorerDerived {
  const nicheKey = resolveNicheKey(model, filters.nicheKey);
  const activeNiche = model.niches[nicheKey]!;
  const qty = clampRequestedQuantity(filters.requestedQuantity);
  const ageBuckets =
    filters.selectedAgeBuckets.length > 0
      ? filters.selectedAgeBuckets
      : AGE_BUCKET_OPTIONS.map((b) => b.key);

  const candidates = activeNiche.states.filter((s) =>
    matchesTimezone(s.timezones, filters.selectedTimezone)
  );

  const availabilities = candidates.map((s) =>
    filteredAvailableForState(
      s.countsByAgeBucket,
      ageBuckets,
      s.dataStatus
    )
  );
  const maxKnown = Math.max(
    0,
    ...availabilities.filter((_, i) => candidates[i]!.dataStatus === "known")
  );

  const states: DerivedStateInventory[] = candidates.map((s, i) => {
    const filteredAvailable = availabilities[i]!;
    const fulfillmentStatus = computeFulfillmentStatus(
      filteredAvailable,
      qty,
      s.dataStatus
    );
    const fullOrdersPossible = computeFullOrdersPossible(
      filteredAvailable,
      qty,
      s.dataStatus
    );
    return {
      ...s,
      filteredAvailable,
      relativeVolumeBand: volumeBand(filteredAvailable, s.dataStatus, maxKnown),
      fulfillmentRatio:
        s.dataStatus === "unknown" || qty <= 0 ? 0 : filteredAvailable / qty,
      fulfillmentStatus,
      fullOrdersPossible,
      customQuoteEligible:
        s.dataStatus === "known" &&
        filteredAvailable > 0 &&
        filteredAvailable < qty,
      selected: selectedStateCodes.has(s.stateCode),
    };
  });

  const allStates: DerivedStateInventory[] = activeNiche.states.map((s) => {
    const inCandidates = states.find((x) => x.stateCode === s.stateCode);
    if (inCandidates) return inCandidates;
    return {
      ...s,
      filteredAvailable: 0,
      relativeVolumeBand:
        s.dataStatus === "unknown" ? "unknown" : ("none" as const),
      fulfillmentRatio: 0,
      fulfillmentStatus:
        s.dataStatus === "unknown" ? "unknown" : ("unavailable" as const),
      fullOrdersPossible: 0,
      customQuoteEligible: false,
      selected: selectedStateCodes.has(s.stateCode),
    };
  });

  const matchingKnown = allStates.filter(
    (s) =>
      s.dataStatus === "known" &&
      matchesTimezone(s.timezones, filters.selectedTimezone)
  );
  const totalMatching = matchingKnown.reduce(
    (sum, s) => sum + s.filteredAvailable,
    0
  );
  const statesWithInventory = matchingKnown.filter(
    (s) => s.filteredAvailable > 0
  ).length;
  const statesThatCanFulfill = matchingKnown.filter(
    (s) =>
      s.fulfillmentStatus === "strong" || s.fulfillmentStatus === "available"
  ).length;

  const selectedKnown = matchingKnown.filter((s) => s.selected);
  const selectedSum = selectedKnown.reduce(
    (sum, s) => sum + s.filteredAvailable,
    0
  );
  const estimatedShortfall = Math.max(0, qty - selectedSum);

  const completedLabel = new Date(
    activeNiche.snapshot.completedAt
  ).toLocaleDateString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
  });

  const knownStates = allStates.filter((s) => s.dataStatus === "known").length;
  const unknownStates = allStates.filter(
    (s) => s.dataStatus === "unknown"
  ).length;

  return {
    filters: {
      ...filters,
      nicheKey,
      requestedQuantity: qty,
      selectedAgeBuckets: ageBuckets,
    },
    activeNiche,
    states: allStates,
    rankedStates: rankInventoryStates(allStates),
    kpis: {
      totalMatching,
      statesWithInventory,
      statesThatCanFulfill,
      estimatedShortfall,
      snapshotFreshnessLabel: `Completed ${completedLabel} UTC`,
      knownStates,
      unknownStates,
      unmappedInventoryTotal: activeNiche.snapshot.unmappedTotals.combined,
    },
  };
}
