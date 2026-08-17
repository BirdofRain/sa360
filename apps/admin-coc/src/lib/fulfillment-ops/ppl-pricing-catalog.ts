/**
 * Admin C.O.C. view of the server PPL pricing catalog.
 * Prices are never authored here. Presentation labels are fallbacks only.
 */

export type PplPricedCatalogBucket = {
  key: string;
  label: string;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  unitPriceCents: number;
  status: "active";
};

export type PplHoldCatalogBucket = {
  key: string;
  label: string;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  workingTargetCents?: number;
  status: "HOLD" | "TBD";
};

export type PplPricingCatalog = {
  pricingVersion: string;
  activeAgedBuckets: PplPricedCatalogBucket[];
  holdBuckets: PplHoldCatalogBucket[];
};

/** Presentation-only labels if the server omits a display name. Never used as price. */
export const PPL_BUCKET_PRESENTATION_LABELS: Record<string, string> = {
  FRESH: "Fresh",
  SEMI_FRESH: "Semi-Fresh",
  COMMERCE_1_3_MO: "1–3 Months",
  COMMERCE_3_6_MO: "3–6 Months",
  COMMERCE_6_9_MO: "6–9 Months",
  COMMERCE_9_12_MO: "9–12 Months",
  COMMERCE_12_MO_PLUS: "12+ Months",
};

export function presentationLabelForBucket(key: string, serverLabel?: string | null): string {
  const trimmed = serverLabel?.trim();
  if (trimmed) return trimmed;
  return PPL_BUCKET_PRESENTATION_LABELS[key] ?? key;
}

export function isSelectablePricedBucket(bucket: PplPricedCatalogBucket): boolean {
  return bucket.status === "active" && Number.isInteger(bucket.unitPriceCents) && bucket.unitPriceCents >= 0;
}

export function findSelectableBucket(
  catalog: PplPricingCatalog | null,
  key: string
): PplPricedCatalogBucket | null {
  if (!catalog) return null;
  const found = catalog.activeAgedBuckets.find((row) => row.key === key);
  if (!found || !isSelectablePricedBucket(found)) return null;
  return found;
}

export function formatUsdFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
