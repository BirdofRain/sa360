/**
 * Authoritative server-side PPL aged lead pricing registry.
 * Do not derive prices from UI literals. Fresh / Semi-Fresh remain HOLD / TBD.
 */

import {
  COMMERCE_AGE_BUCKETS,
  type CommerceAgeBucketKey,
  isCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";

export const PPL_AGED_PRICING_VERSION = "ppl_aged_beta_2026_08_v1" as const;

export type PplAgedPricingVersion = typeof PPL_AGED_PRICING_VERSION;

export type PplHoldBucketKey = "FRESH" | "SEMI_FRESH";

export type PplPricedAgeBucket = {
  key: CommerceAgeBucketKey;
  label: string;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  unitPriceCents: number;
  status: "active";
};

export type PplHoldAgeBucket = {
  key: PplHoldBucketKey;
  label: string;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  /** Working target only — not purchasable. */
  workingTargetCents: number;
  status: "HOLD" | "TBD";
};

const DEFAULT_AGED_UNIT_PRICE_CENTS: Record<CommerceAgeBucketKey, number> = {
  COMMERCE_1_3_MO: 600,
  COMMERCE_3_6_MO: 400,
  COMMERCE_6_9_MO: 300,
  COMMERCE_9_12_MO: 200,
  COMMERCE_12_MO_PLUS: 100,
};

const BUCKET_LABELS: Record<CommerceAgeBucketKey, string> = {
  COMMERCE_1_3_MO: "1–3 Months",
  COMMERCE_3_6_MO: "3–6 Months",
  COMMERCE_6_9_MO: "6–9 Months",
  COMMERCE_9_12_MO: "9–12 Months",
  COMMERCE_12_MO_PLUS: "12+ Months",
};

/** Reserved for future niche-specific overrides; empty in this beta. */
const NICHE_UNIT_PRICE_OVERRIDES: Record<
  string,
  Partial<Record<CommerceAgeBucketKey, number>>
> = {};

export const PPL_HOLD_AGE_BUCKETS: readonly PplHoldAgeBucket[] = [
  {
    key: "FRESH",
    label: "Fresh",
    minDaysInclusive: 0,
    maxDaysExclusive: 10,
    workingTargetCents: 1500,
    status: "HOLD",
  },
  {
    key: "SEMI_FRESH",
    label: "Semi-Fresh",
    minDaysInclusive: 10,
    maxDaysExclusive: 30,
    workingTargetCents: 1200,
    status: "HOLD",
  },
] as const;

export function listActivePplAgedPrices(
  nicheKey?: string
): readonly PplPricedAgeBucket[] {
  const niche = nicheKey?.trim().toLowerCase() ?? "";
  const overrides = niche ? NICHE_UNIT_PRICE_OVERRIDES[niche] ?? {} : {};
  return COMMERCE_AGE_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: BUCKET_LABELS[bucket.key],
    minDaysInclusive: bucket.minDaysInclusive,
    maxDaysExclusive: bucket.maxDaysExclusive,
    unitPriceCents: overrides[bucket.key] ?? DEFAULT_AGED_UNIT_PRICE_CENTS[bucket.key],
    status: "active" as const,
  }));
}

export function resolvePplAgedUnitPriceCents(input: {
  commerceAgeBucketKey: string;
  nicheKey?: string;
  pricingVersion?: string;
}):
  | { ok: true; unitPriceCents: number; pricingVersion: PplAgedPricingVersion; label: string }
  | { ok: false; code: "unknown_bucket" | "hold_bucket" | "unsupported_pricing_version" } {
  const version = input.pricingVersion?.trim() || PPL_AGED_PRICING_VERSION;
  if (version !== PPL_AGED_PRICING_VERSION) {
    return { ok: false, code: "unsupported_pricing_version" };
  }

  const key = input.commerceAgeBucketKey.trim();
  if (key === "FRESH" || key === "SEMI_FRESH") {
    return { ok: false, code: "hold_bucket" };
  }
  if (!isCommerceAgeBucketKey(key)) {
    return { ok: false, code: "unknown_bucket" };
  }

  const priced = listActivePplAgedPrices(input.nicheKey).find((row) => row.key === key);
  if (!priced) return { ok: false, code: "unknown_bucket" };

  return {
    ok: true,
    unitPriceCents: priced.unitPriceCents,
    pricingVersion: PPL_AGED_PRICING_VERSION,
    label: priced.label,
  };
}

export function computePplLineTotalCents(
  requestedQuantity: number,
  unitPriceCents: number
): number {
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 0) {
    throw new Error("requested_quantity_invalid");
  }
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error("unit_price_invalid");
  }
  return requestedQuantity * unitPriceCents;
}

export function isPurchasablePplAgedBucket(key: unknown): key is CommerceAgeBucketKey {
  return isCommerceAgeBucketKey(key);
}

export function isHoldPplBucket(key: unknown): key is PplHoldBucketKey {
  return key === "FRESH" || key === "SEMI_FRESH";
}
