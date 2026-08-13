import type { CommerceAgeBucketKey, CommerceAgeBucketRequestKey } from "./commerce-age-buckets.js";

/**
 * For priced Client Lead Orders, selection must use the snapshotted commerce bucket.
 * Legacy/demo orders without a priced line keep request-key compatibility.
 */
export function resolveSelectionCommerceBuckets(input: {
  requestBuckets: CommerceAgeBucketRequestKey[];
  pricedCommerceAgeBucketKey: CommerceAgeBucketKey | null;
}):
  | { ok: true; commerceAgeBucketKeys: CommerceAgeBucketRequestKey[] }
  | {
      ok: false;
      code: "priced_bucket_mismatch";
      reasons: string[];
    } {
  if (!input.pricedCommerceAgeBucketKey) {
    return { ok: true, commerceAgeBucketKeys: input.requestBuckets };
  }

  const locked = [input.pricedCommerceAgeBucketKey] as CommerceAgeBucketRequestKey[];
  if (
    input.requestBuckets.length > 0 &&
    (input.requestBuckets.length !== 1 ||
      input.requestBuckets[0] !== input.pricedCommerceAgeBucketKey)
  ) {
    return {
      ok: false,
      code: "priced_bucket_mismatch",
      reasons: [
        "selection_bucket_must_match_priced_order_line",
        `order_bucket:${input.pricedCommerceAgeBucketKey}`,
        `request_buckets:${input.requestBuckets.join(",")}`,
      ],
    };
  }
  return { ok: true, commerceAgeBucketKeys: locked };
}
