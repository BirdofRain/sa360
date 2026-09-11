/**
 * Canonical commerce age-bucket catalog lives in `@sa360/shared`.
 * This module re-exports it so existing PPL fulfillment imports stay stable.
 */
export {
  COMMERCE_AGE_BUCKETS,
  LEGACY_COMMERCE_6_12_MO,
  ageDaysInCommerceBucket,
  expandCommerceAgeBucketRanges,
  generatedAtFilterForCommerceAgeRanges,
  isCommerceAgeBucketKey,
  isCommerceAgeBucketRequestKey,
  parseCommerceAgeBucketKeys,
  resolveCommerceAgeBucketKey,
  type CommerceAgeBucket,
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
  type LegacyCommerceAgeBucketKey,
} from "@sa360/shared";
