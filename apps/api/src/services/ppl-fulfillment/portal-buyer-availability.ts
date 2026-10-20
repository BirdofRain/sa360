/**
 * Customer-safe projection of lookupBuyerInventoryAvailability.
 * Eligibility, dedupe, origin, and open-allocation rules stay in that service.
 * This module does not count inventory itself.
 */

import {
  lookupBuyerInventoryAvailability,
  type BuyerAvailabilityTierCount,
  type BuyerInventoryAvailabilityResult,
} from "./buyer-inventory-availability.service.js";

export const PORTAL_BUYER_AVAILABILITY_CACHE_TTL_MS = 15_000;
export const PORTAL_BUYER_AVAILABILITY_CACHE_MAX = 100;

const STATE_MATRIX_NOTE =
  "Buyer-eligible counts are for the selected states together. A per-state matrix is not available from the canonical availability snapshot, so individual states stay unknown.";

export type PortalBuyerAvailabilityDisplay = "estimate" | "at_least" | "unknown";

export type PortalBuyerAvailabilityBucket = {
  commerceAgeBucketKey: string;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  eligible: number | null;
  countSemantics: BuyerAvailabilityTierCount["countSemantics"];
  display: PortalBuyerAvailabilityDisplay;
};

export type PortalBuyerAvailabilityView = {
  ok: true;
  policyVersion: "buyer-inventory-availability-v1";
  reservesInventory: false;
  evaluatedAt: string;
  snapshot: {
    consistent: true;
    scope: "transaction_start";
  };
  criteria: {
    nicheKey: string;
    states: string[];
    commerceAgeBucketKeys: string[];
    productType: null;
  };
  queryCompleteness: "complete" | "incomplete";
  countSemantics: "exact" | "lower_bound";
  stateMatrix: null;
  stateMatrixNote: string;
  buckets: PortalBuyerAvailabilityBucket[];
};

export type PortalBuyerAvailabilityFailure = {
  ok: false;
  code: string;
  reasons: string[];
};

type Lookup = typeof lookupBuyerInventoryAvailability;

type CacheEntry = {
  expiresAt: number;
  value: PortalBuyerAvailabilityView;
};

const cache = new Map<string, CacheEntry>();

export function resetPortalBuyerAvailabilityCache(): void {
  cache.clear();
}

export function portalAvailabilityDisplay(
  tier: Pick<BuyerAvailabilityTierCount, "eligible" | "countSemantics">
): PortalBuyerAvailabilityDisplay {
  if (tier.countSemantics === "not_reached" || tier.eligible == null) return "unknown";
  if (tier.countSemantics === "lower_bound") return "at_least";
  return "estimate";
}

export function projectPortalBuyerAvailability(
  result: Extract<BuyerInventoryAvailabilityResult, { ok: true }>,
  criteria: PortalBuyerAvailabilityView["criteria"]
): PortalBuyerAvailabilityView {
  return {
    ok: true,
    policyVersion: "buyer-inventory-availability-v1",
    reservesInventory: false,
    evaluatedAt: result.evaluatedAt,
    snapshot: {
      consistent: true,
      scope: "transaction_start",
    },
    criteria: {
      nicheKey: criteria.nicheKey,
      states: [...criteria.states],
      commerceAgeBucketKeys: [...criteria.commerceAgeBucketKeys],
      productType: null,
    },
    queryCompleteness: result.queryCompleteness,
    countSemantics: result.eligibleCountSemantics,
    stateMatrix: null,
    stateMatrixNote: STATE_MATRIX_NOTE,
    buckets: result.ageTiers.map((tier) => ({
      commerceAgeBucketKey: tier.commerceAgeBucketKey,
      minDaysInclusive: tier.minDaysInclusive,
      maxDaysExclusive: tier.maxDaysExclusive,
      eligible: tier.eligible,
      countSemantics: tier.countSemantics,
      display: portalAvailabilityDisplay(tier),
    })),
  };
}

function cacheKey(input: {
  clientAccountId: string;
  nicheKey: string;
  states: readonly string[];
  commerceAgeBucketKeys: readonly string[];
}): string {
  return [
    input.clientAccountId,
    input.nicheKey,
    [...input.states].sort().join(","),
    [...input.commerceAgeBucketKeys].sort().join(","),
  ].join("\u0000");
}

function readCache(key: string, now: number): PortalBuyerAvailabilityView | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: PortalBuyerAvailabilityView, now: number) {
  if (cache.size >= PORTAL_BUYER_AVAILABILITY_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: now + PORTAL_BUYER_AVAILABILITY_CACHE_TTL_MS, value });
}

export async function lookupPortalBuyerAvailability(
  input: {
    clientAccountId: string;
    nicheKey: string;
    states: readonly string[];
    commerceAgeBucketKeys: readonly string[];
    productType?: string | null;
    now?: number;
  },
  deps: { lookup?: Lookup } = {}
): Promise<PortalBuyerAvailabilityView | PortalBuyerAvailabilityFailure> {
  const productType = input.productType?.trim() ?? "";
  if (productType) {
    return {
      ok: false,
      code: "unsupported_filter",
      reasons: ["product_type_not_supported", "filter_not_applied"],
    };
  }
  const lookup = deps.lookup ?? lookupBuyerInventoryAvailability;
  const states = [...input.states];
  const commerceAgeBucketKeys = [...input.commerceAgeBucketKeys];
  const key = cacheKey({
    clientAccountId: input.clientAccountId,
    nicheKey: input.nicheKey,
    states,
    commerceAgeBucketKeys,
  });
  const now = input.now ?? Date.now();
  const cached = readCache(key, now);
  if (cached) return cached;

  const result = await lookup({
    clientAccountId: input.clientAccountId,
    nicheKey: input.nicheKey,
    states,
    commerceAgeBucketKeys,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, reasons: result.reasons };
  }
  const view = projectPortalBuyerAvailability(result, {
    nicheKey: result.nicheKey,
    states: result.states,
    commerceAgeBucketKeys: result.allAgedTiers
      ? result.ageTiers.map((tier) => tier.commerceAgeBucketKey)
      : [...result.requestedCommerceAgeBucketKeys],
    productType: null,
  });
  writeCache(key, view, now);
  return view;
}
