export type CommerceAgeBucketKey =
  | "COMMERCE_1_3_MO"
  | "COMMERCE_3_6_MO"
  | "COMMERCE_6_9_MO"
  | "COMMERCE_9_12_MO"
  | "COMMERCE_12_MO_PLUS";

/**
 * Legacy key previously used for day 180–&lt;365.
 * Still accepted as a request filter for old scripts/tests, but never emitted by
 * resolveCommerceAgeBucketKey for new classifications. Persisted historical
 * decisionReasonsJson values that store COMMERCE_6_12_MO are left unchanged.
 */
export type LegacyCommerceAgeBucketKey = "COMMERCE_6_12_MO";

export type CommerceAgeBucketRequestKey = CommerceAgeBucketKey | LegacyCommerceAgeBucketKey;

export type CommerceAgeBucket = {
  key: CommerceAgeBucketKey;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  sortOrder: number;
};

/** Active commercial aged buckets for PPL CSV beta. Leads under day 30 are excluded. */
export const COMMERCE_AGE_BUCKETS: CommerceAgeBucket[] = [
  {
    key: "COMMERCE_1_3_MO",
    minDaysInclusive: 30,
    maxDaysExclusive: 90,
    sortOrder: 10,
  },
  {
    key: "COMMERCE_3_6_MO",
    minDaysInclusive: 90,
    maxDaysExclusive: 180,
    sortOrder: 20,
  },
  {
    key: "COMMERCE_6_9_MO",
    minDaysInclusive: 180,
    maxDaysExclusive: 270,
    sortOrder: 30,
  },
  {
    key: "COMMERCE_9_12_MO",
    minDaysInclusive: 270,
    maxDaysExclusive: 365,
    sortOrder: 40,
  },
  {
    key: "COMMERCE_12_MO_PLUS",
    minDaysInclusive: 365,
    maxDaysExclusive: null,
    sortOrder: 50,
  },
];

/** Legacy request-only filter: day 180 through &lt;365 (union of 6–9 and 9–12). */
export const LEGACY_COMMERCE_6_12_MO = {
  key: "COMMERCE_6_12_MO" as const,
  minDaysInclusive: 180,
  maxDaysExclusive: 365,
};

const COMMERCE_AGE_BUCKET_KEY_SET = new Set<string>(
  COMMERCE_AGE_BUCKETS.map((bucket) => bucket.key)
);

const COMMERCE_AGE_BUCKET_REQUEST_KEY_SET = new Set<string>([
  ...COMMERCE_AGE_BUCKET_KEY_SET,
  LEGACY_COMMERCE_6_12_MO.key,
]);

export function isCommerceAgeBucketKey(value: unknown): value is CommerceAgeBucketKey {
  return typeof value === "string" && COMMERCE_AGE_BUCKET_KEY_SET.has(value);
}

export function isCommerceAgeBucketRequestKey(
  value: unknown
): value is CommerceAgeBucketRequestKey {
  return typeof value === "string" && COMMERCE_AGE_BUCKET_REQUEST_KEY_SET.has(value);
}

export function resolveCommerceAgeBucketKey(ageDays: number): CommerceAgeBucketKey | null {
  const sorted = [...COMMERCE_AGE_BUCKETS].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const bucket of sorted) {
    if (ageDays < bucket.minDaysInclusive) continue;
    if (bucket.maxDaysExclusive == null || ageDays < bucket.maxDaysExclusive) {
      return bucket.key;
    }
  }
  return null;
}

export function ageDaysInCommerceBucket(
  ageDays: number,
  key: CommerceAgeBucketRequestKey
): boolean {
  if (key === LEGACY_COMMERCE_6_12_MO.key) {
    if (ageDays < LEGACY_COMMERCE_6_12_MO.minDaysInclusive) return false;
    return ageDays < LEGACY_COMMERCE_6_12_MO.maxDaysExclusive;
  }
  const bucket = COMMERCE_AGE_BUCKETS.find((entry) => entry.key === key);
  if (!bucket) return false;
  if (ageDays < bucket.minDaysInclusive) return false;
  if (bucket.maxDaysExclusive == null) return true;
  return ageDays < bucket.maxDaysExclusive;
}

/**
 * Expand request keys into concrete day ranges for DB generatedAt prefiltering.
 * Legacy COMMERCE_6_12_MO expands to [180, 365).
 */
export function expandCommerceAgeBucketRanges(
  keys: CommerceAgeBucketRequestKey[]
): Array<{ minDaysInclusive: number; maxDaysExclusive: number | null }> {
  if (keys.length === 0) {
    return COMMERCE_AGE_BUCKETS.map((bucket) => ({
      minDaysInclusive: bucket.minDaysInclusive,
      maxDaysExclusive: bucket.maxDaysExclusive,
    }));
  }

  const ranges: Array<{ minDaysInclusive: number; maxDaysExclusive: number | null }> = [];
  for (const key of keys) {
    if (key === LEGACY_COMMERCE_6_12_MO.key) {
      ranges.push({
        minDaysInclusive: LEGACY_COMMERCE_6_12_MO.minDaysInclusive,
        maxDaysExclusive: LEGACY_COMMERCE_6_12_MO.maxDaysExclusive,
      });
      continue;
    }
    const bucket = COMMERCE_AGE_BUCKETS.find((entry) => entry.key === key);
    if (!bucket) continue;
    ranges.push({
      minDaysInclusive: bucket.minDaysInclusive,
      maxDaysExclusive: bucket.maxDaysExclusive,
    });
  }
  return ranges;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convert commerce age day ranges to generatedAt filters matching
 * calculateInventoryAgeDays (floor elapsed whole days).
 *
 * ageDays >= min  ⇒ generatedAt <= evaluatedAt - min days
 * ageDays < max   ⇒ generatedAt > evaluatedAt - max days
 */
export function generatedAtFilterForCommerceAgeRanges(
  ranges: Array<{ minDaysInclusive: number; maxDaysExclusive: number | null }>,
  evaluatedAt: Date
): Array<{ gt?: Date; lte: Date }> {
  const evalMs = evaluatedAt.getTime();
  return ranges.map((range) => {
    const lte = new Date(evalMs - range.minDaysInclusive * MS_PER_DAY);
    if (range.maxDaysExclusive == null) {
      return { lte };
    }
    return {
      gt: new Date(evalMs - range.maxDaysExclusive * MS_PER_DAY),
      lte,
    };
  });
}

export function parseCommerceAgeBucketKeys(value: unknown): CommerceAgeBucketRequestKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<CommerceAgeBucketRequestKey>();
  const keys: CommerceAgeBucketRequestKey[] = [];
  for (const entry of value) {
    if (!isCommerceAgeBucketRequestKey(entry) || seen.has(entry)) continue;
    seen.add(entry);
    keys.push(entry);
  }
  return keys;
}
