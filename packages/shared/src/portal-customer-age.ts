import {
  COMMERCE_AGE_BUCKETS,
  LEGACY_COMMERCE_6_12_MO,
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
} from "./commerce-age-buckets.js";

/**
 * Customer portal age choices. Each choice is one priced commerce bucket.
 * COMMERCE_6_12_MO remains a legacy request key for orders already saved as
 * the 6–9 and 9–12 union. New orders do not offer it.
 */
export const PORTAL_CUSTOMER_AGE_CHOICES = [
  { key: "COMMERCE_1_3_MO", label: "1–3 months" },
  { key: "COMMERCE_3_6_MO", label: "3–6 months" },
  { key: "COMMERCE_6_9_MO", label: "6–9 months" },
  { key: "COMMERCE_9_12_MO", label: "9–12 months" },
  { key: "COMMERCE_12_MO_PLUS", label: "12+ months" },
] as const;

export type PortalCustomerAgeChoice = (typeof PORTAL_CUSTOMER_AGE_CHOICES)[number]["key"];

/** Constituent buckets on historical portal 6–12 union lines. Not a new-order choice. */
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
  const choice = PORTAL_CUSTOMER_AGE_CHOICES.find((entry) => entry.key === key);
  if (choice) return choice.label;
  if (key === LEGACY_COMMERCE_6_12_MO.key) return "6–12 months";
  return null;
}

export function portalCustomerAgeDayRange(key: PortalCustomerAgeChoice): {
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
} {
  const bucket = COMMERCE_AGE_BUCKETS.find((entry) => entry.key === key);
  if (!bucket) {
    throw new Error("portal_customer_age_choice_missing");
  }
  return {
    minDaysInclusive: bucket.minDaysInclusive,
    maxDaysExclusive: bucket.maxDaysExclusive,
  };
}

/** Selection request keys. Each new-order choice queries that commerce bucket directly. */
export function portalCustomerAgeFulfillmentKeys(
  key: PortalCustomerAgeChoice
): CommerceAgeBucketRequestKey[] {
  return [key];
}

export function isPortal6To12ConstituentSet(keys: readonly string[]): boolean {
  if (keys.length !== PORTAL_6_12_CONSTITUENT_KEYS.length) return false;
  const seen = new Set(keys);
  return PORTAL_6_12_CONSTITUENT_KEYS.every((key) => seen.has(key));
}
