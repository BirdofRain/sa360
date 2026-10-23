import { isPortal6To12ConstituentSet } from "@sa360/shared";

import type { CommerceAgeBucketKey, CommerceAgeBucketRequestKey } from "./commerce-age-buckets.js";

function sameRequestKeys(
  actual: CommerceAgeBucketRequestKey[],
  expected: CommerceAgeBucketRequestKey[]
): boolean {
  if (actual.length !== expected.length) return false;
  const seen = new Set(actual);
  return expected.every((key) => seen.has(key));
}

/**
 * For priced Client Lead Orders, selection must use the snapshotted commerce bucket.
 * A portal 6–12 line locks to the legacy union key, which matches both 6–9 and 9–12.
 * Older-lead consent does not add buckets. Legacy/demo orders without a priced line
 * or a union lock keep request-key compatibility.
 */
export function resolveSelectionCommerceBuckets(input: {
  requestBuckets: CommerceAgeBucketRequestKey[];
  pricedCommerceAgeBucketKey: CommerceAgeBucketKey | null;
  portalSelectionLock?: CommerceAgeBucketRequestKey[] | null;
  /**
   * Recorded for callers. Consent never widens the locked range and never
   * authorizes younger leads or extra states.
   */
  shortfallPolicy?: string | null;
}):
  | { ok: true; commerceAgeBucketKeys: CommerceAgeBucketRequestKey[] }
  | {
      ok: false;
      code: "priced_bucket_mismatch";
      reasons: string[];
    } {
  const consent = input.shortfallPolicy ?? null;
  if (input.pricedCommerceAgeBucketKey) {
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
          `older_lead_consent:${consent === "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT" ? "yes" : "no"}`,
        ],
      };
    }
    return { ok: true, commerceAgeBucketKeys: locked };
  }

  const portalLock = input.portalSelectionLock ?? null;
  if (portalLock && portalLock.length > 0) {
    const union =
      portalLock.length === 1 && portalLock[0] === "COMMERCE_6_12_MO"
        ? (["COMMERCE_6_12_MO"] as CommerceAgeBucketRequestKey[])
        : null;
    if (!union) {
      return {
        ok: false,
        code: "priced_bucket_mismatch",
        reasons: ["portal_selection_lock_unsupported", `lock:${portalLock.join(",")}`],
      };
    }
    const requestIsUnion =
      input.requestBuckets.length === 0 ||
      sameRequestKeys(input.requestBuckets, union) ||
      isPortal6To12ConstituentSet(input.requestBuckets);
    if (!requestIsUnion) {
      return {
        ok: false,
        code: "priced_bucket_mismatch",
        reasons: [
          "selection_bucket_must_match_portal_age_union",
          "order_bucket:COMMERCE_6_12_MO",
          `request_buckets:${input.requestBuckets.join(",")}`,
          `older_lead_consent:${consent === "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT" ? "yes" : "no"}`,
        ],
      };
    }
    return { ok: true, commerceAgeBucketKeys: union };
  }

  return { ok: true, commerceAgeBucketKeys: input.requestBuckets };
}
