import {
  CANONICAL_US_STATE_CODES,
  isCommerceAgeBucketRequestKey,
  type CommerceAgeBucketRequestKey,
} from "@sa360/shared";

export const PORTAL_INVENTORY_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Must match `BUYER_INVENTORY_AVAILABILITY_POLICY` in the API lookup.
 * A snapshot from any other policy is not cached and is not shown.
 */
export const PORTAL_BUYER_AVAILABILITY_POLICY = "buyer-inventory-availability-v1";

export const PORTAL_MAP_CANONICAL_STATES = CANONICAL_US_STATE_CODES;

/**
 * Portal map bands. The same thresholds apply to every age range, including 6–12.
 *
 * - Available: exact or lower-bound eligible count is at least the requested quantity.
 * - Limited: exact eligible count is greater than zero and below the requested quantity.
 * - Currently unavailable: exact eligible count is zero.
 * - No band: the count is null, not reached, or only a lower bound below the request.
 *   That state is “Availability unavailable” and is not zero inventory.
 */
export const PORTAL_AVAILABILITY_BAND_RULES = {
  availableMinimum: "exact_or_lower_bound_at_least_requested_quantity",
  limited: "exact_count_greater_than_zero_and_below_requested_quantity",
  currentlyUnavailable: "exact_count_zero",
  unavailable: "null_not_reached_or_lower_bound_below_requested_quantity",
} as const;

export type PortalInventoryAvailabilityTier =
  | "Available"
  | "Limited"
  | "Currently unavailable";

export type PortalInventoryLookupStatus = "ready" | "disabled" | "unavailable";

export type PortalInventoryStateAvailability = {
  state: string;
  /** Null means this state has no established band. It is not zero inventory. */
  availability: PortalInventoryAvailabilityTier | null;
};

export type PortalInventoryAvailabilityResponse = {
  ok: true;
  evaluatedAt: string | null;
  stale: boolean;
  mappingSupported: boolean;
  mappingNote: string;
  lookupStatus: PortalInventoryLookupStatus;
  criteria: {
    nicheKey: string;
    requestedAgeBucket: CommerceAgeBucketRequestKey;
    requestedQuantity: number;
  };
  states: PortalInventoryStateAvailability[];
};

export type PortalBuyerAvailabilityStateCount = {
  state: string;
  eligible: number | null;
  countSemantics: "exact" | "lower_bound" | "not_reached";
};

export type PortalBuyerAvailabilitySnapshot = {
  clientAccountId: string;
  policyVersion: string;
  nicheKey: string;
  commerceAgeBucketKey: CommerceAgeBucketRequestKey;
  states: string[];
  evaluatedAt: string;
  eligibleByState: PortalBuyerAvailabilityStateCount[];
};

const READY_NOTE =
  "Colors use this account's eligible inventory for the selected age range. Gray means availability is unavailable for that state, not that inventory is zero. Selecting a state does not reserve leads.";

export function isPortalInventoryMapEnabled(
  env?: { SA360_PORTAL_INVENTORY_MAP_ENABLED?: string }
): boolean {
  const value =
    env === undefined
      ? process.env.SA360_PORTAL_INVENTORY_MAP_ENABLED
      : env.SA360_PORTAL_INVENTORY_MAP_ENABLED;
  return value?.trim().toLowerCase() === "true";
}

export function parsePortalInventoryAvailabilityQuery(
  searchParams: URLSearchParams
):
  | {
      ok: true;
      value: {
        nicheKey: string;
        requestedAgeBucket: CommerceAgeBucketRequestKey;
        requestedQuantity: number;
      };
    }
  | { ok: false; error: string } {
  if (searchParams.has("clientAccountId")) {
    return { ok: false, error: "clientAccountId cannot be supplied by the browser" };
  }
  const nicheKey = searchParams.get("nicheKey")?.trim() ?? "";
  const requestedAgeBucket = searchParams.get("requestedAgeBucket");
  const requestedQuantity = Number(searchParams.get("requestedQuantity"));
  if (!nicheKey || nicheKey.length > 80) {
    return { ok: false, error: "Choose a valid lead type." };
  }
  if (!isCommerceAgeBucketRequestKey(requestedAgeBucket)) {
    return { ok: false, error: "Choose a supported age bucket." };
  }
  if (
    !Number.isInteger(requestedQuantity) ||
    requestedQuantity < 1 ||
    requestedQuantity > 1_000_000
  ) {
    return { ok: false, error: "Enter a quantity between 1 and 1,000,000." };
  }
  return {
    ok: true,
    value: {
      nicheKey,
      requestedAgeBucket,
      requestedQuantity,
    },
  };
}

export function portalAvailabilityBand(input: {
  eligible: number | null;
  countSemantics: "exact" | "lower_bound" | "not_reached";
  requestedQuantity: number;
}): PortalInventoryAvailabilityTier | null {
  if (input.eligible == null || input.countSemantics === "not_reached") return null;
  if (!Number.isInteger(input.eligible) || input.eligible < 0) return null;
  if (!Number.isInteger(input.requestedQuantity) || input.requestedQuantity < 1) return null;
  if (input.countSemantics === "lower_bound") {
    return input.eligible >= input.requestedQuantity ? "Available" : null;
  }
  if (input.countSemantics !== "exact") return null;
  if (input.eligible === 0) return "Currently unavailable";
  if (input.eligible < input.requestedQuantity) return "Limited";
  return "Available";
}

export function portalBuyerMapUnavailable(input: {
  nicheKey: string;
  requestedAgeBucket: CommerceAgeBucketRequestKey;
  requestedQuantity: number;
  lookupStatus: "disabled" | "unavailable";
}): PortalInventoryAvailabilityResponse {
  return {
    ok: true,
    evaluatedAt: null,
    stale: false,
    mappingSupported: false,
    mappingNote:
      input.lookupStatus === "disabled"
        ? "Availability lookup is disabled."
        : "Availability is temporarily unavailable.",
    lookupStatus: input.lookupStatus,
    criteria: {
      nicheKey: input.nicheKey,
      requestedAgeBucket: input.requestedAgeBucket,
      requestedQuantity: input.requestedQuantity,
    },
    states: [],
  };
}

function evaluatedIsStale(evaluatedAt: string, now: Date): boolean {
  const evaluatedMs = Date.parse(evaluatedAt);
  return (
    !Number.isFinite(evaluatedMs) || now.getTime() - evaluatedMs > PORTAL_INVENTORY_STALE_AFTER_MS
  );
}

export function projectPortalBuyerMapAvailability(input: {
  snapshot: PortalBuyerAvailabilitySnapshot;
  requestedQuantity: number;
  now?: Date;
}): PortalInventoryAvailabilityResponse {
  const now = input.now ?? new Date();
  return {
    ok: true,
    evaluatedAt: input.snapshot.evaluatedAt,
    stale: evaluatedIsStale(input.snapshot.evaluatedAt, now),
    mappingSupported: true,
    mappingNote: READY_NOTE,
    lookupStatus: "ready",
    criteria: {
      nicheKey: input.snapshot.nicheKey,
      requestedAgeBucket: input.snapshot.commerceAgeBucketKey,
      requestedQuantity: input.requestedQuantity,
    },
    states: input.snapshot.eligibleByState.map((row) => ({
      state: row.state,
      availability: portalAvailabilityBand({
        eligible: row.eligible,
        countSemantics: row.countSemantics,
        requestedQuantity: input.requestedQuantity,
      }),
    })),
  };
}
