import {
  clearPortalBuyerAvailabilityCache,
  portalBuyerAvailabilityCacheKey,
  readCachedPortalBuyerAvailability,
  sameCanonicalStateSet,
  writeCachedPortalBuyerAvailability,
  canonicalPortalMapStates,
} from "./portal-buyer-availability-cache.ts";
import type { CommerceAgeBucketRequestKey } from "@sa360/shared";

import {
  PORTAL_BUYER_AVAILABILITY_POLICY,
  portalBuyerMapUnavailable,
  projectPortalBuyerMapAvailability,
  type PortalBuyerAvailabilitySnapshot,
  type PortalInventoryAvailabilityResponse,
} from "./portal-inventory-map.ts";

export type PortalBuyerAvailabilityFetchResult =
  | { ok: true; snapshot: PortalBuyerAvailabilitySnapshot }
  | { ok: false; status: number; code: string | null };

export type PortalBuyerMapLoadResult =
  | { ok: true; availability: PortalInventoryAvailabilityResponse }
  | { ok: false; status: number; error: string };

function cacheKeyFor(input: {
  clientAccountId: string;
  nicheKey: string;
  requestedAgeBucket: string;
}): string {
  return portalBuyerAvailabilityCacheKey({
    clientAccountId: input.clientAccountId,
    policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
    nicheKey: input.nicheKey,
    commerceAgeBucketKey: input.requestedAgeBucket,
    states: canonicalPortalMapStates(),
  });
}

function snapshotMatchesRequest(
  snapshot: PortalBuyerAvailabilitySnapshot,
  input: {
    clientAccountId: string;
    nicheKey: string;
    requestedAgeBucket: CommerceAgeBucketRequestKey;
  }
): boolean {
  return (
    snapshot.clientAccountId === input.clientAccountId &&
    snapshot.policyVersion === PORTAL_BUYER_AVAILABILITY_POLICY &&
    snapshot.nicheKey === input.nicheKey &&
    snapshot.commerceAgeBucketKey === input.requestedAgeBucket &&
    sameCanonicalStateSet(snapshot.states) &&
    sameCanonicalStateSet(snapshot.eligibleByState.map((row) => row.state))
  );
}

export async function loadPortalBuyerMapAvailability(input: {
  clientAccountId: string;
  nicheKey: string;
  requestedAgeBucket: CommerceAgeBucketRequestKey;
  requestedQuantity: number;
  now?: Date;
  fetchSnapshot: (query: {
    clientAccountId: string;
    nicheKey: string;
    commerceAgeBucketKey: CommerceAgeBucketRequestKey;
    states: readonly string[];
  }) => Promise<PortalBuyerAvailabilityFetchResult>;
}): Promise<PortalBuyerMapLoadResult> {
  const nowMs = (input.now ?? new Date()).getTime();
  const key = cacheKeyFor(input);
  const cached = readCachedPortalBuyerAvailability(
    key,
    {
      clientAccountId: input.clientAccountId,
      policyVersion: PORTAL_BUYER_AVAILABILITY_POLICY,
      nicheKey: input.nicheKey,
      commerceAgeBucketKey: input.requestedAgeBucket,
    },
    nowMs
  );
  if (cached) {
    return {
      ok: true,
      availability: projectPortalBuyerMapAvailability({
        snapshot: cached,
        requestedQuantity: input.requestedQuantity,
        now: input.now,
      }),
    };
  }

  let fetched: PortalBuyerAvailabilityFetchResult;
  try {
    fetched = await input.fetchSnapshot({
      clientAccountId: input.clientAccountId,
      nicheKey: input.nicheKey,
      commerceAgeBucketKey: input.requestedAgeBucket,
      states: canonicalPortalMapStates(),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Availability is temporarily unavailable.",
    };
  }

  if (!fetched.ok) {
    if (fetched.code === "buyer_inventory_availability_disabled") {
      return {
        ok: true,
        availability: portalBuyerMapUnavailable({
          nicheKey: input.nicheKey,
          requestedAgeBucket: input.requestedAgeBucket,
          requestedQuantity: input.requestedQuantity,
          lookupStatus: "disabled",
        }),
      };
    }
    return {
      ok: false,
      status: fetched.status >= 400 ? fetched.status : 502,
      error: "Availability is temporarily unavailable.",
    };
  }

  if (!snapshotMatchesRequest(fetched.snapshot, input)) {
    return {
      ok: true,
      availability: portalBuyerMapUnavailable({
        nicheKey: input.nicheKey,
        requestedAgeBucket: input.requestedAgeBucket,
        requestedQuantity: input.requestedQuantity,
        lookupStatus: "unavailable",
      }),
    };
  }

  writeCachedPortalBuyerAvailability(key, fetched.snapshot, nowMs);
  return {
    ok: true,
    availability: projectPortalBuyerMapAvailability({
      snapshot: fetched.snapshot,
      requestedQuantity: input.requestedQuantity,
      now: input.now,
    }),
  };
}

export { clearPortalBuyerAvailabilityCache };
