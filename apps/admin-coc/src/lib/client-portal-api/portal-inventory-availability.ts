import "server-only";

import { resolvePortalOrderCreateEligibility } from "./portal-order-create.ts";
import {
  fetchClientLeadsOnDemandAvailability,
  type ClientLeadsOnDemandAvailabilityResult,
} from "./server.ts";

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 100;

type CacheEntry = {
  expiresAt: number;
  value: ClientLeadsOnDemandAvailabilityResult;
};

const availabilityCache = new Map<string, CacheEntry>();

function cacheKey(input: {
  clientAccountId: string;
  nicheKey: string;
  productType?: string;
}): string {
  return `${input.clientAccountId}\u0000${input.nicheKey}\u0000${input.productType ?? ""}`;
}

function putCache(key: string, value: ClientLeadsOnDemandAvailabilityResult, now: number) {
  if (availabilityCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = availabilityCache.keys().next().value;
    if (oldest) availabilityCache.delete(oldest);
  }
  availabilityCache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
}

export async function loadPortalInventoryAvailability(input: {
  clientAccountId: string;
  nicheKey: string;
  productType?: string;
}): Promise<
  | { ok: true; availability: ClientLeadsOnDemandAvailabilityResult }
  | { ok: false; status: number; error: string }
> {
  const eligibility = await resolvePortalOrderCreateEligibility({
    clientAccountId: input.clientAccountId,
  });
  if (!eligibility.ok) {
    return {
      ok: false,
      status: eligibility.status,
      error: eligibility.error,
    };
  }

  const key = cacheKey(input);
  const now = Date.now();
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { ok: true, availability: cached.value };
  }
  if (cached) availabilityCache.delete(key);

  const availability = await fetchClientLeadsOnDemandAvailability(input);
  if (availability.error) {
    return {
      ok: false,
      status: 502,
      error: "Inventory availability is temporarily unavailable.",
    };
  }
  putCache(key, availability, now);
  return { ok: true, availability };
}
