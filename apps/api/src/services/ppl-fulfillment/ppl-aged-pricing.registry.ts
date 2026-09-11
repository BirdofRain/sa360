/**
 * Authoritative PPL aged lead pricing registry lives in `@sa360/shared`.
 * This module re-exports it so existing PPL fulfillment imports stay stable.
 * Do not author a second price table here.
 */
export {
  PPL_AGED_PRICING_VERSION,
  PPL_HOLD_AGE_BUCKETS,
  computePplLineTotalCents,
  isHoldPplBucket,
  isPurchasablePplAgedBucket,
  listActivePplAgedPrices,
  pplAgedBucketLabel,
  resolvePplAgedUnitPriceCents,
  type PplAgedPricingVersion,
  type PplHoldAgeBucket,
  type PplHoldBucketKey,
  type PplPricedAgeBucket,
} from "@sa360/shared";
