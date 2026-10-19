import { findSelectableBucket, type PplPricingCatalog } from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import type { FulfillmentOpsOrder } from "@/lib/fulfillment-ops/types";

/**
 * Authoritative Stage 2b / export quantity for an existing order.
 * Matches the DTO semantics already used in the export context panel.
 * Never uses remainingCapacity — that is leftover inventory, not the purchased qty.
 */
export function authoritativeOrderQuantity(
  order: FulfillmentOpsOrder,
  lineId?: string | null
): number {
  const lines = order.lines ?? [];
  if (lineId) {
    const line = lines.find((entry) => entry.lineId === lineId);
    if (line) return line.requestedQuantity;
  }
  if (lines.length === 1) return lines[0]!.requestedQuantity;
  if (lines.length > 1) return order.requestedQuantity ?? order.leadVolume;
  return order.pricing?.requestedQuantity ?? order.requestedQuantity ?? order.leadVolume;
}

/** Multi-line orders must name one persisted line. A single priced line keeps its id. */
export function resolveStage2bLeadOrderLineId(
  order: FulfillmentOpsOrder,
  operatorLineId: string
): string | undefined {
  const lines = order.lines ?? [];
  if (lines.length > 1) {
    return lines.some((line) => line.lineId === operatorLineId) ? operatorLineId : undefined;
  }
  if (lines.length === 1 && lines[0]?.lineId) return lines[0].lineId;
  return undefined;
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
  const lines = order.lines ?? [];
  if (lines.length > 1) {
    const match = lines.find((line) => line.lineId === operatorBucketKey);
    return match ? [match.commerceAgeBucketKey] : null;
  }
  if (lines.length === 1) return [lines[0]!.commerceAgeBucketKey];

  const priced = order.pricing?.commerceAgeBucketKey?.trim();
  if (priced) return [priced];

  const key = operatorBucketKey.trim();
  if (!key || key.includes(",")) return null;
  if (!findSelectableBucket(catalog, key)) return null;
  return [key];
}
