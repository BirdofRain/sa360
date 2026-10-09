import {
  CANONICAL_US_STATE_CODES,
  isCanonicalUsStateCode,
  isCommerceAgeBucketKey,
  type CommerceAgeBucketKey,
} from "@sa360/shared";

import type { ClientLeadsOnDemandAvailabilityRow } from "../client-portal-api/server.ts";

export const PORTAL_INVENTORY_STALE_AFTER_MS = 30 * 60 * 1000;

export type PortalInventoryAvailabilityTier =
  | "Available"
  | "Limited"
  | "Currently unavailable";

export type PortalInventoryStateAvailability = {
  state: string;
  availability: PortalInventoryAvailabilityTier;
};

export type PortalInventoryAvailabilityResponse = {
  ok: true;
  evaluatedAt: string | null;
  stale: boolean;
  mappingSupported: boolean;
  mappingNote: string;
  criteria: {
    nicheKey: string;
    productType: string | null;
    requestedAgeBucket: CommerceAgeBucketKey;
    requestedQuantity: number;
  };
  states: PortalInventoryStateAvailability[];
};

type AgeBandMapping = {
  labels: readonly string[];
  note: string;
};

/**
 * The inventory API currently emits broad operational bands rather than commerce
 * buckets. Only bands that do not combine two commerce buckets are used. Boundary
 * days not represented by the source band remain review-time inventory.
 */
const SOURCE_AGE_BANDS_BY_COMMERCE_BUCKET: Partial<
  Record<CommerceAgeBucketKey, AgeBandMapping>
> = {
  COMMERCE_1_3_MO: {
    labels: ["31–60 days", "61–90 days"],
    note: "Shows the source inventory bands covering days 31–90. Day 30 is confirmed during review.",
  },
  COMMERCE_3_6_MO: {
    labels: ["91–180 days"],
    note: "Shows the source inventory band covering days 91–180. Day 90 is confirmed during review.",
  },
  COMMERCE_12_MO_PLUS: {
    labels: ["366+ days"],
    note: "Shows the source inventory band covering 366+ days. Day 365 is confirmed during review.",
  },
};

const TIER_RANK: Record<PortalInventoryAvailabilityTier, number> = {
  "Currently unavailable": 0,
  Limited: 1,
  Available: 2,
};

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
        productType?: string;
        requestedAgeBucket: CommerceAgeBucketKey;
        requestedQuantity: number;
      };
    }
  | { ok: false; error: string } {
  if (searchParams.has("clientAccountId")) {
    return { ok: false, error: "clientAccountId cannot be supplied by the browser" };
  }
  const nicheKey = searchParams.get("nicheKey")?.trim() ?? "";
  const productType = searchParams.get("productType")?.trim() ?? "";
  const requestedAgeBucket = searchParams.get("requestedAgeBucket");
  const requestedQuantity = Number(searchParams.get("requestedQuantity"));
  if (!nicheKey || nicheKey.length > 80) {
    return { ok: false, error: "Choose a valid lead type." };
  }
  if (productType.length > 120) {
    return { ok: false, error: "Choose a valid product." };
  }
  if (!isCommerceAgeBucketKey(requestedAgeBucket)) {
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
      ...(productType ? { productType } : {}),
      requestedAgeBucket,
      requestedQuantity,
    },
  };
}

export function buildPortalInventoryAvailability(input: {
  rows: ClientLeadsOnDemandAvailabilityRow[];
  evaluatedAt: string | null;
  nicheKey: string;
  productType?: string;
  requestedAgeBucket: CommerceAgeBucketKey;
  requestedQuantity: number;
  now?: Date;
}): PortalInventoryAvailabilityResponse {
  const mapping = SOURCE_AGE_BANDS_BY_COMMERCE_BUCKET[input.requestedAgeBucket];
  const criteria = {
    nicheKey: input.nicheKey,
    productType: input.productType ?? null,
    requestedAgeBucket: input.requestedAgeBucket,
    requestedQuantity: input.requestedQuantity,
  };
  const evaluatedMs = input.evaluatedAt ? Date.parse(input.evaluatedAt) : Number.NaN;
  const stale =
    !Number.isFinite(evaluatedMs) ||
    (input.now ?? new Date()).getTime() - evaluatedMs > PORTAL_INVENTORY_STALE_AFTER_MS;

  if (!mapping) {
    return {
      ok: true,
      evaluatedAt: input.evaluatedAt,
      stale,
      mappingSupported: false,
      mappingNote:
        "The inventory source combines this age range with another commerce bucket, so state availability cannot be shown safely.",
      criteria,
      states: [],
    };
  }

  const labels = new Set(mapping.labels);
  const byState = new Map<string, PortalInventoryAvailabilityTier>();
  for (const row of input.rows) {
    if (
      row.nicheKey !== input.nicheKey ||
      (input.productType && row.productType !== input.productType) ||
      !labels.has(row.ageBandLabel) ||
      !isCanonicalUsStateCode(row.state)
    ) {
      continue;
    }
    const current = byState.get(row.state) ?? "Currently unavailable";
    if (TIER_RANK[row.availabilityLabel] > TIER_RANK[current]) {
      byState.set(row.state, row.availabilityLabel);
    }
  }

  return {
    ok: true,
    evaluatedAt: input.evaluatedAt,
    stale,
    mappingSupported: true,
    mappingNote: mapping.note,
    criteria,
    states: CANONICAL_US_STATE_CODES.map((state) => ({
      state,
      availability: byState.get(state) ?? "Currently unavailable",
    })),
  };
}
