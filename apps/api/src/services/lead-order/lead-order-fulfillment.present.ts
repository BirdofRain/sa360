/**
 * Customer-facing lead-order fulfillment read contract.
 *
 * Audit (do not treat stored counters as interchangeable):
 * 1. Requested quantity: `requestedQuantity` when set (LF2 / PPL / fulfillment-ops);
 *    otherwise `leadVolume` (always stored; client/admin create path).
 * 2. Fulfilled quantity: count of `LeadAllocation` rows with status `committed`
 *    for this order. That row is the persisted order → delivered-lead link.
 * 3. Remaining quantity: max(requested - committedCount, 0). Reserved holds are
 *    not delivered and are not subtracted for customers.
 * 4. `LeadOrder.fulfilledQuantity` increments only in LF2 live
 *    `commitFulfillmentSuccess`. PPL spreadsheet delivery commits allocations
 *    without incrementing the stored counter, so the column is not customer-safe.
 * 5. `reservedQuantity` is a reservation hold, not delivery.
 * 6. Legacy/client-created orders often have null `requestedQuantity` and default
 *    zero counters. If tracking is not configured and no committed allocations
 *    exist, return null rather than a fake zero.
 * 7. Do not infer order↔lead linkage from client, dates, niche, state, or campaign.
 */

export const CLIENT_LEAD_ORDER_FULFILLMENT_UNAVAILABLE_SUMMARY =
  "Fulfillment tracking will appear here once delivery is linked.";

export const LEAD_ORDER_FULFILLMENT_STATUSES = [
  "not_started",
  "in_progress",
  "fulfilled",
] as const;

export type LeadOrderFulfillmentStatus = (typeof LEAD_ORDER_FULFILLMENT_STATUSES)[number];

export type LeadOrderClientFulfillment = {
  requestedQuantity: number;
  fulfilledQuantity: number;
  remainingQuantity: number;
  status: LeadOrderFulfillmentStatus;
};

export type LeadOrderFulfillmentSource = {
  leadVolume: number;
  requestedQuantity?: number | null;
  committedAllocationCount?: number | null;
};

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 0) return null;
  return n;
}

export function resolveRequestedOrderQuantity(row: LeadOrderFulfillmentSource): number | null {
  const configured = asNonNegativeInt(row.requestedQuantity);
  if (configured != null && configured > 0) return configured;
  const volume = asNonNegativeInt(row.leadVolume);
  if (volume != null && volume > 0) return volume;
  return null;
}

export function isLeadOrderFulfillmentAvailable(
  row: LeadOrderFulfillmentSource,
  committedAllocationCount: number
): boolean {
  const configured =
    typeof row.requestedQuantity === "number" &&
    Number.isFinite(row.requestedQuantity) &&
    row.requestedQuantity > 0;
  return configured || committedAllocationCount > 0;
}

export function presentLeadOrderFulfillment(
  row: LeadOrderFulfillmentSource
): LeadOrderClientFulfillment | null {
  const committed = asNonNegativeInt(row.committedAllocationCount) ?? 0;
  if (!isLeadOrderFulfillmentAvailable(row, committed)) {
    return null;
  }

  const requested = resolveRequestedOrderQuantity(row);
  if (requested == null) return null;

  const fulfilled = committed;
  const remaining = Math.max(requested - fulfilled, 0);
  const status: LeadOrderFulfillmentStatus =
    fulfilled <= 0 ? "not_started" : fulfilled >= requested ? "fulfilled" : "in_progress";

  return {
    requestedQuantity: requested,
    fulfilledQuantity: fulfilled,
    remainingQuantity: remaining,
    status,
  };
}

export function presentLeadOrderFulfillmentSummary(
  fulfillment: LeadOrderClientFulfillment | null
): string {
  if (!fulfillment) return CLIENT_LEAD_ORDER_FULFILLMENT_UNAVAILABLE_SUMMARY;
  return `${fulfillment.fulfilledQuantity} of ${fulfillment.requestedQuantity} delivered`;
}
