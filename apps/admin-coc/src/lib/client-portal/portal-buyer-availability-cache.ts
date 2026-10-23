import {
  PORTAL_MAP_CANONICAL_STATES,
  type PortalBuyerAvailabilitySnapshot,
} from "./portal-inventory-map.ts";

export const PORTAL_BUYER_AVAILABILITY_CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 100;

type CacheEntry = {
  expiresAt: number;
  value: PortalBuyerAvailabilitySnapshot;
};

const availabilityCache = new Map<string, CacheEntry>();

export function portalBuyerAvailabilityCacheKey(input: {
  clientAccountId: string;
  policyVersion: string;
  nicheKey: string;
  commerceAgeBucketKey: string;
  states: readonly string[];
}): string {
  const states = [...input.states]
    .map((state) => state.trim().toUpperCase())
    .sort()
    .join(",");
  return [
    input.clientAccountId.trim(),
    input.policyVersion.trim(),
    input.nicheKey.trim(),
    input.commerceAgeBucketKey.trim(),
    states,
  ].join("\u0000");
}

export function canonicalPortalMapStates(): string[] {
  return [...PORTAL_MAP_CANONICAL_STATES];
}

export function sameCanonicalStateSet(states: readonly string[]): boolean {
  const expected = canonicalPortalMapStates();
  if (states.length !== expected.length) return false;
  const seen = new Set(states.map((state) => state.trim().toUpperCase()));
  return expected.every((state) => seen.has(state));
}

export function readCachedPortalBuyerAvailability(
  key: string,
  expected: {
    clientAccountId: string;
    policyVersion: string;
    nicheKey: string;
    commerceAgeBucketKey: string;
  },
  now = Date.now()
): PortalBuyerAvailabilitySnapshot | null {
  const cached = availabilityCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    availabilityCache.delete(key);
    return null;
  }
  const value = cached.value;
  if (
    value.clientAccountId !== expected.clientAccountId ||
    value.policyVersion !== expected.policyVersion ||
    value.nicheKey !== expected.nicheKey ||
    value.commerceAgeBucketKey !== expected.commerceAgeBucketKey ||
    !sameCanonicalStateSet(value.states) ||
    !sameCanonicalStateSet(value.eligibleByState.map((row) => row.state))
  ) {
    return null;
  }
  return value;
}

export function writeCachedPortalBuyerAvailability(
  key: string,
  value: PortalBuyerAvailabilitySnapshot,
  now = Date.now()
): void {
  if (availabilityCache.size >= CACHE_MAX_ENTRIES && !availabilityCache.has(key)) {
    const oldest = availabilityCache.keys().next().value;
    if (oldest) availabilityCache.delete(oldest);
  }
  availabilityCache.set(key, {
    expiresAt: now + PORTAL_BUYER_AVAILABILITY_CACHE_TTL_MS,
    value,
  });
}

export function clearPortalBuyerAvailabilityCache(): void {
  availabilityCache.clear();
}
