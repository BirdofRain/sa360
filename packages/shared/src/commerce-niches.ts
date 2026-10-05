/**
 * Buyer-facing aged PPL commerce niche identity.
 *
 * Source intake may keep detailed provenance keys (for example vet_fex,
 * nurse_life). This module is the only alias map. Do not copy it into apps
 * and do not mass-rewrite LeadInventoryItem.nicheKey.
 *
 * Unknown niches stay unknown. `unspecified`, health, mortgage, and final
 * expense are not collapsed into Veteran, Nurse, or Trucker.
 */

export const CANONICAL_COMMERCE_NICHE_KEYS = ["vet", "nurse", "trucker"] as const;

export type CanonicalCommerceNicheKey = (typeof CANONICAL_COMMERCE_NICHE_KEYS)[number];

export const CANONICAL_COMMERCE_NICHE_LABELS: Record<CanonicalCommerceNicheKey, string> = {
  vet: "Veteran",
  nurse: "Nurse",
  trucker: "Trucker",
};

/**
 * Explicit aliases, stored in normalized form.
 * `n_vet` / `n_veteran` are the Smart Agent 360 Demo profile values that
 * render as "N Veteran" (sa360_niche_key VET → n_vet).
 * `n_nurse` is the same demo map's NURSE option.
 */
const COMMERCE_NICHE_ALIASES: Record<CanonicalCommerceNicheKey, readonly string[]> = {
  vet: ["vet", "veteran", "vet_fex", "n_vet", "n_veteran"],
  nurse: ["nurse", "nurse_life", "n_nurse"],
  trucker: ["trucker", "trucker_life"],
};

const CANONICAL_KEY_SET = new Set<string>(CANONICAL_COMMERCE_NICHE_KEYS);

const ALIAS_TO_CANONICAL = new Map<string, CanonicalCommerceNicheKey>();
for (const canonical of CANONICAL_COMMERCE_NICHE_KEYS) {
  for (const alias of COMMERCE_NICHE_ALIASES[canonical]) {
    ALIAS_TO_CANONICAL.set(alias, canonical);
  }
}

/** Trim, lowercase, and fold whitespace/hyphens into single underscores. */
export function normalizeCommerceNicheToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function isCanonicalCommerceNicheKey(value: unknown): value is CanonicalCommerceNicheKey {
  return typeof value === "string" && CANONICAL_KEY_SET.has(normalizeCommerceNicheToken(value));
}

export function canonicalizeCommerceNicheKey(value: unknown): CanonicalCommerceNicheKey | null {
  if (typeof value !== "string") return null;
  const token = normalizeCommerceNicheToken(value);
  if (!token) return null;
  return ALIAS_TO_CANONICAL.get(token) ?? null;
}

export function isSupportedAgedCommerceNiche(value: unknown): boolean {
  return canonicalizeCommerceNicheKey(value) != null;
}

export function commerceNicheDisplayName(value: unknown): string | undefined {
  const canonical = canonicalizeCommerceNicheKey(value);
  if (!canonical) return undefined;
  return CANONICAL_COMMERCE_NICHE_LABELS[canonical];
}

export function commerceNicheAliases(canonicalKey: CanonicalCommerceNicheKey): readonly string[] {
  return COMMERCE_NICHE_ALIASES[canonicalKey];
}

/**
 * Keys that count as the same buyer-facing niche.
 * Unknown values return only their trimmed original so callers keep exact match.
 */
export function commerceNicheMatchKeys(value: string): readonly string[] {
  const canonical = canonicalizeCommerceNicheKey(value);
  if (!canonical) {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return COMMERCE_NICHE_ALIASES[canonical];
}

export function commerceNichesEquivalent(left: string, right: string): boolean {
  const leftCanonical = canonicalizeCommerceNicheKey(left);
  const rightCanonical = canonicalizeCommerceNicheKey(right);
  if (leftCanonical && rightCanonical) return leftCanonical === rightCanonical;
  if (leftCanonical || rightCanonical) return false;
  const leftToken = normalizeCommerceNicheToken(left);
  const rightToken = normalizeCommerceNicheToken(right);
  return leftToken.length > 0 && leftToken === rightToken;
}

/** Persist canonical keys on new commercial records; leave unknown values unchanged. */
export function preferCanonicalCommerceNicheKey(value: string): string {
  return canonicalizeCommerceNicheKey(value) ?? value.trim();
}

export type CommerceNicheDistributionRow = {
  nicheKey: string;
  count: number;
  label: string;
  review: boolean;
};

/**
 * Fold raw inventory niche counts into Veteran / Nurse / Trucker.
 * Unsupported keys stay as separate review rows so counts are not lost
 * and are not merged into a sellable niche.
 */
export function aggregateCommerceNicheDistribution(
  rows: ReadonlyArray<{ nicheKey: string; count: number }>
): CommerceNicheDistributionRow[] {
  const totals = new Map<CanonicalCommerceNicheKey, number>();
  const review: CommerceNicheDistributionRow[] = [];

  for (const row of rows) {
    const count = Number.isFinite(row.count) ? row.count : 0;
    const canonical = canonicalizeCommerceNicheKey(row.nicheKey);
    if (!canonical) {
      const nicheKey = row.nicheKey.trim() || "unspecified";
      review.push({
        nicheKey,
        count,
        label: `${nicheKey} · review`,
        review: true,
      });
      continue;
    }
    totals.set(canonical, (totals.get(canonical) ?? 0) + count);
  }

  const supported: CommerceNicheDistributionRow[] = [];
  for (const nicheKey of CANONICAL_COMMERCE_NICHE_KEYS) {
    const count = totals.get(nicheKey);
    if (count == null) continue;
    supported.push({
      nicheKey,
      count,
      label: CANONICAL_COMMERCE_NICHE_LABELS[nicheKey],
      review: false,
    });
  }

  review.sort((left, right) => left.nicheKey.localeCompare(right.nicheKey));
  return [...supported, ...review];
}
