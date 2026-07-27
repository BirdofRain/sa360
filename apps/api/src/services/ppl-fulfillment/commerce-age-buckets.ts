export type CommerceAgeBucketKey =
  | "COMMERCE_1_3_MO"
  | "COMMERCE_3_6_MO"
  | "COMMERCE_6_12_MO"
  | "COMMERCE_12_MO_PLUS";

export type CommerceAgeBucket = {
  key: CommerceAgeBucketKey;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  sortOrder: number;
};

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
    key: "COMMERCE_6_12_MO",
    minDaysInclusive: 180,
    maxDaysExclusive: 365,
    sortOrder: 30,
  },
  {
    key: "COMMERCE_12_MO_PLUS",
    minDaysInclusive: 365,
    maxDaysExclusive: null,
    sortOrder: 40,
  },
];

const COMMERCE_AGE_BUCKET_KEY_SET = new Set<string>(
  COMMERCE_AGE_BUCKETS.map((bucket) => bucket.key)
);

export function isCommerceAgeBucketKey(value: unknown): value is CommerceAgeBucketKey {
  return typeof value === "string" && COMMERCE_AGE_BUCKET_KEY_SET.has(value);
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

export function ageDaysInCommerceBucket(ageDays: number, key: CommerceAgeBucketKey): boolean {
  const bucket = COMMERCE_AGE_BUCKETS.find((entry) => entry.key === key);
  if (!bucket) return false;
  if (ageDays < bucket.minDaysInclusive) return false;
  if (bucket.maxDaysExclusive == null) return true;
  return ageDays < bucket.maxDaysExclusive;
}

export function parseCommerceAgeBucketKeys(value: unknown): CommerceAgeBucketKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<CommerceAgeBucketKey>();
  const keys: CommerceAgeBucketKey[] = [];
  for (const entry of value) {
    if (!isCommerceAgeBucketKey(entry) || seen.has(entry)) continue;
    seen.add(entry);
    keys.push(entry);
  }
  return keys;
}
