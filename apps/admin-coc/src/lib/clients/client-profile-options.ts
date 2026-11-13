import {
  CLIENT_PROFILE_NICHE_OPTIONS,
  CLIENT_PROFILE_PRODUCT_OPTIONS,
  type ClientProfileCatalogOption,
} from "@sa360/shared";

export type ClientProfileOption = ClientProfileCatalogOption;
export const CLIENT_NICHE_OPTIONS = CLIENT_PROFILE_NICHE_OPTIONS;
export const CLIENT_PRODUCT_OPTIONS = CLIENT_PROFILE_PRODUCT_OPTIONS;

/**
 * Existing-client choices: the current catalog, plus any saved values it no
 * longer lists. New-client pickers keep the catalog alone so legacy keys are
 * not offered as new choices.
 */
export function profileChoicesIncludingSavedValues(
  catalog: readonly ClientProfileOption[],
  saved: readonly string[]
): ClientProfileOption[] {
  const catalogKeys = new Set(catalog.map((option) => option.value.trim().toLocaleLowerCase()));
  const extras: ClientProfileOption[] = [];
  const seen = new Set<string>();
  for (const raw of saved) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase();
    if (!value || catalogKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    extras.push({ value, label: value });
  }
  return [...catalog, ...extras];
}
