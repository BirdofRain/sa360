/**
 * Canonical customer-facing niche display names.
 * Consumed by buyer CSV presentation and the customer portal formatter.
 * Do not duplicate this map in apps.
 */
export const NICHE_DISPLAY_NAMES = {
  vet: "Veteran",
  veteran: "Veteran",
  trucker: "Trucker",
  nurse: "Nurse",
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

/** Exact lookup only. Unknown keys return undefined so callers keep their own fallback. */
export function lookupNicheDisplayName(nicheKey: string): string | undefined {
  const key = normalizeNicheDisplayKey(nicheKey);
  if (!key) return undefined;
  return NICHE_DISPLAY_NAMES[key as NicheDisplayNameKey];
}
