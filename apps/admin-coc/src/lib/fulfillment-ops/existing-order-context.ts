import { findSelectableBucket, type PplPricingCatalog } from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import type { FulfillmentOpsOrder } from "@/lib/fulfillment-ops/types";

/**
 * Authoritative Stage 2b / export quantity for an existing order.
 * Matches the DTO semantics already used in the export context panel.
 * Never uses remainingCapacity — that is leftover inventory, not the purchased qty.
 */
export function authoritativeOrderQuantity(order: FulfillmentOpsOrder): number {
  return order.pricing?.requestedQuantity ?? order.requestedQuantity ?? order.leadVolume;
}

export function fulfillmentOpsClientLabel(
  order: Pick<FulfillmentOpsOrder, "clientDisplayName">
): string {
  const name = order.clientDisplayName?.trim();
  return name ? name : "Unnamed client";
}

export function formatFulfillmentOpsOrderOption(order: FulfillmentOpsOrder): string {
  return `${order.orderNumber} — ${fulfillmentOpsClientLabel(order)} — ${order.nicheKey} — ${order.status}`;
}

/**
 * Stage 2b commerce age buckets to send on Preview/Commit.
 * Priced: lock to the order's priced key (array of one).
 * Unpriced: exactly one operator-chosen selectable catalog bucket.
 * Returns null when the operator has not made a valid choice — callers must not POST.
 * Never defaults to all five buckets. Never returns an empty array.
 */
export function resolveStage2bCommerceAgeBucketKeys(
  order: FulfillmentOpsOrder,
  operatorBucketKey: string,
  catalog: PplPricingCatalog | null
): string[] | null {
  const priced = order.pricing?.commerceAgeBucketKey?.trim();
  if (priced) return [priced];

  const key = operatorBucketKey.trim();
  if (!key || key.includes(",")) return null;
  if (!findSelectableBucket(catalog, key)) return null;
  return [key];
}
