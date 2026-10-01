export type ClientProfileCatalogOption = { value: string; label: string };

/**
 * Administrative profile suggestions. ClientAccount intentionally stores
 * free-form arrays, and catalog presence does not imply intake, pricing,
 * routing, or fulfillment support.
 */
export const CLIENT_PROFILE_NICHE_OPTIONS: readonly ClientProfileCatalogOption[] = [
  { value: "VET", label: "Veteran (VET)" },
  { value: "NURSE", label: "Nurse" },
  { value: "HEALTH", label: "Health insurance" },
  { value: "MTG", label: "Mortgage" },
  { value: "FEX", label: "Final expense" },
  { value: "IUL", label: "Indexed universal life (IUL)" },
];

export const CLIENT_PROFILE_PRODUCT_OPTIONS: readonly ClientProfileCatalogOption[] = [
  { value: "final_expense", label: "Final expense" },
  { value: "term_life", label: "Term life" },
  { value: "aged", label: "Aged leads" },
  { value: "exclusive", label: "Exclusive" },
  { value: "shared", label: "Shared" },
];
