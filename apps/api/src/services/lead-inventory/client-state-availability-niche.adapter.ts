/**
 * TEMPORARY ADAPTER — portal live inventory map lane.
 *
 * The canonical commerce-niche contract (buyer-facing Veteran / Nurse / Trucker
 * aliasing such as `vet_fex` → `vet`) is owned by a parallel workstream and is
 * not on `master` yet. This lane must not duplicate that normalization.
 *
 * Until the shared helpers land (`@sa360/shared` commerce niches +
 * `services/commerce/commerce-niche-match`), the map read model passes the
 * buyer's selected niche key straight through to the facet aggregate's
 * `nicheKey` filter. The matching semantics (exact match today, canonical
 * alias match after the commerce lane merges) live inside that filter, not
 * here.
 *
 * Replace or delete this module once the commerce lane's helpers are on
 * `master`; the map read model should then import the shared helper directly.
 */
export function adaptPortalNicheKeyForInventoryFilter(
  nicheKey: string | undefined
): string | undefined {
  const trimmed = nicheKey?.trim();
  return trimmed ? trimmed : undefined;
}
