import {
  resolveCommerceAgeBucketKey,
  type CommerceAgeBucketKey,
} from "./commerce-age-buckets.js";
import { isHoldPplBucket, isPurchasablePplAgedBucket } from "./ppl-aged-pricing.registry.js";

/**
 * Derived inventory commerce lifecycle. Not persisted.
 * Age is floor elapsed whole UTC days from authoritative generatedAt.
 */
export type InventoryCommerceLifecycleKey =
  | "FRESH_HOLD"
  | "SEMI_FRESH_HOLD"
  | CommerceAgeBucketKey
  | "DATE_MISSING";

export const FRESH_HOLD_MIN_DAYS_INCLUSIVE = 0;
export const FRESH_HOLD_MAX_DAYS_EXCLUSIVE = 10;
export const SEMI_FRESH_HOLD_MIN_DAYS_INCLUSIVE = 10;
export const SEMI_FRESH_HOLD_MAX_DAYS_EXCLUSIVE = 30;

export function resolveInventoryCommerceLifecycle(
  ageDays: number | null
): InventoryCommerceLifecycleKey {
  if (ageDays == null || !Number.isFinite(ageDays)) return "DATE_MISSING";
  if (ageDays < FRESH_HOLD_MAX_DAYS_EXCLUSIVE) return "FRESH_HOLD";
  if (ageDays < SEMI_FRESH_HOLD_MAX_DAYS_EXCLUSIVE) return "SEMI_FRESH_HOLD";
  return resolveCommerceAgeBucketKey(ageDays) ?? "DATE_MISSING";
}

export function isHoldInventoryCommerceLifecycle(
  key: InventoryCommerceLifecycleKey
): key is "FRESH_HOLD" | "SEMI_FRESH_HOLD" {
  return key === "FRESH_HOLD" || key === "SEMI_FRESH_HOLD";
}

export function isPurchasableInventoryCommerceLifecycle(
  key: InventoryCommerceLifecycleKey
): key is CommerceAgeBucketKey {
  if (isHoldInventoryCommerceLifecycle(key) || key === "DATE_MISSING") return false;
  return isPurchasablePplAgedBucket(key) && !isHoldPplBucket(key);
}
