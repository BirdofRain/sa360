export type ClientProfileCatalogOption = { value: string; label: string };

/**
 * Administrative profile suggestions. ClientAccount intentionally stores
 * free-form arrays, and catalog presence does not imply intake, pricing,
 * routing, or fulfillment support.
 */
export const CLIENT_PROFILE_NICHE_OPTIONS: readonly ClientProfileCatalogOption[] = [
  { value: "VET", label: "VETERAN" },
  { value: "NURSE", label: "NURSE" },
  { value: "MTG", label: "MORTGAGE" },
  { value: "TRUCKER", label: "TRUCKER" },
  { value: "HEALTH", label: "HEALTH" },
  { value: "IUL", label: "IUL" },
  { value: "FEX", label: "FEX" },
];

export const CLIENT_PROFILE_PRODUCT_OPTIONS: readonly ClientProfileCatalogOption[] = [
  { value: "life_insurance", label: "Life Insurance" },
  { value: "health_insurance", label: "Health Insurance" },
  { value: "other", label: "Other" },
];
