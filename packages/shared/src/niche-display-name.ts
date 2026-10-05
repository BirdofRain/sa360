/**
 * Canonical customer-facing niche display names.
 * Veteran / Nurse / Trucker labels come from the commerce niche contract.
 * Consumed by buyer CSV presentation and the customer portal formatter.
 * Do not duplicate this map in apps.
 */
import { CANONICAL_COMMERCE_NICHE_LABELS, commerceNicheDisplayName } from "./commerce-niches.js";

export const NICHE_DISPLAY_NAMES = {
  vet: CANONICAL_COMMERCE_NICHE_LABELS.vet,
  veteran: CANONICAL_COMMERCE_NICHE_LABELS.vet,
  trucker: CANONICAL_COMMERCE_NICHE_LABELS.trucker,
  nurse: CANONICAL_COMMERCE_NICHE_LABELS.nurse,
  mortgage: "Mortgage",
  solar: "Solar",
  insurance: "Insurance",
  hvac: "HVAC",
  roofing: "Roofing",
} as const;

export type NicheDisplayNameKey = keyof typeof NICHE_DISPLAY_NAMES;

export function normalizeNicheDisplayKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Commerce aliases (vet_fex, nurse_life, n_vet, …) resolve first.
 * Other known tokens use NICHE_DISPLAY_NAMES. Unknown keys return undefined.
 */
export function lookupNicheDisplayName(nicheKey: string): string | undefined {
  const commerce = commerceNicheDisplayName(nicheKey);
  if (commerce) return commerce;
  const key = normalizeNicheDisplayKey(nicheKey);
  if (!key) return undefined;
  return NICHE_DISPLAY_NAMES[key as NicheDisplayNameKey];
}
