import {
  COMMERCE_AGE_BUCKETS,
  LEGACY_COMMERCE_6_12_MO,
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
} from "./commerce-age-buckets.js";

/**
 * Customer portal age choices. Inventory is still classified into the five
 * commerce buckets. 6–12 months is the existing request key for day 180–<365,
 * which is the union of 6–9 and 9–12. It is not a new inventory classification.
 */
export const PORTAL_CUSTOMER_AGE_CHOICES = [
  { key: "COMMERCE_1_3_MO", label: "1–3 months" },
  { key: "COMMERCE_3_6_MO", label: "3–6 months" },
  { key: "COMMERCE_6_12_MO", label: "6–12 months" },
  { key: "COMMERCE_12_MO_PLUS", label: "12+ months" },
] as const;

export type PortalCustomerAgeChoice = (typeof PORTAL_CUSTOMER_AGE_CHOICES)[number]["key"];

/** Stored commerce buckets covered by the portal 6–12 choice. Order is stable. */
export const PORTAL_6_12_CONSTITUENT_KEYS = [
  "COMMERCE_6_9_MO",
  "COMMERCE_9_12_MO",
] as const satisfies readonly CommerceAgeBucketKey[];

const CHOICE_KEYS = new Set<string>(PORTAL_CUSTOMER_AGE_CHOICES.map((choice) => choice.key));

export function isPortalCustomerAgeChoice(value: unknown): value is PortalCustomerAgeChoice {
  return typeof value === "string" && CHOICE_KEYS.has(value);
}

export function portalCustomerAgeChoiceLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return PORTAL_CUSTOMER_AGE_CHOICES.find((choice) => choice.key === key)?.label ?? null;
}

export function portalCustomerAgeDayRange(key: PortalCustomerAgeChoice): {
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
} {
  if (key === LEGACY_COMMERCE_6_12_MO.key) {
    return {
      minDaysInclusive: LEGACY_COMMERCE_6_12_MO.minDaysInclusive,
      maxDaysExclusive: LEGACY_COMMERCE_6_12_MO.maxDaysExclusive,
    };
  }
  const bucket = COMMERCE_AGE_BUCKETS.find((entry) => entry.key === key);
  if (!bucket) {
    throw new Error("portal_customer_age_choice_missing");
  }
  return {
    minDaysInclusive: bucket.minDaysInclusive,
    maxDaysExclusive: bucket.maxDaysExclusive,
  };
}

/** Selection request keys. 6–12 stays the legacy union key fulfillment already matches. */
export function portalCustomerAgeFulfillmentKeys(
  key: PortalCustomerAgeChoice
): CommerceAgeBucketRequestKey[] {
  if (key === "COMMERCE_6_12_MO") return [LEGACY_COMMERCE_6_12_MO.key];
  return [key];
}

export function isPortal6To12ConstituentSet(keys: readonly string[]): boolean {
  if (keys.length !== PORTAL_6_12_CONSTITUENT_KEYS.length) return false;
  const seen = new Set(keys);
  return PORTAL_6_12_CONSTITUENT_KEYS.every((key) => seen.has(key));
}
