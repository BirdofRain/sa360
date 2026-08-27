/**
 * Customer-facing lead-order fulfillment (PR #86 read contract).
 *
 * Show structured counts only when the backend says fulfillment is available
 * and returns a valid `fulfillment` object. Do not invent progress from
 * `leadVolume`, reserved/proposed counters, or a summary sentence alone.
 */

export const PORTAL_ORDER_FULFILLMENT_STATUSES = [
  "not_started",
  "in_progress",
  "fulfilled",
] as const;

export type PortalOrderFulfillmentStatus = (typeof PORTAL_ORDER_FULFILLMENT_STATUSES)[number];

export type PortalOrderFulfillment = {
  requestedQuantity: number;
  fulfilledQuantity: number;
  remainingQuantity: number;
  status: PortalOrderFulfillmentStatus;
};

const STATUS_SET = new Set<string>(PORTAL_ORDER_FULFILLMENT_STATUSES);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 0) return null;
  return n;
}

function asStatus(value: unknown): PortalOrderFulfillmentStatus | null {
  return typeof value === "string" && STATUS_SET.has(value)
    ? (value as PortalOrderFulfillmentStatus)
    : null;
}

export function mapPortalOrderFulfillment(raw: unknown): PortalOrderFulfillment | null {
  const row = asRecord(raw);
  if (!row || row.fulfillmentAvailable !== true) return null;
  const fulfillment = asRecord(row.fulfillment);
  if (!fulfillment) return null;

  const requestedQuantity = asNonNegativeInt(fulfillment.requestedQuantity);
  const fulfilledQuantity = asNonNegativeInt(fulfillment.fulfilledQuantity);
  const remainingQuantity = asNonNegativeInt(fulfillment.remainingQuantity);
  const status = asStatus(fulfillment.status);
  if (
    requestedQuantity == null ||
    requestedQuantity <= 0 ||
    fulfilledQuantity == null ||
    remainingQuantity == null ||
    !status
  ) {
    return null;
  }

  return {
    requestedQuantity,
    fulfilledQuantity,
    remainingQuantity,
    status,
  };
}

export function portalFulfillmentStatusLabel(status: PortalOrderFulfillmentStatus): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "fulfilled":
      return "Fulfilled";
  }
}

export function portalFulfillmentStatusTone(
  status: PortalOrderFulfillmentStatus
): "good" | "warn" | "neutral" {
  if (status === "fulfilled") return "good";
  if (status === "in_progress") return "warn";
  return "neutral";
}

/** Presentation-only. Caps over-fulfillment so a progress bar cannot overflow. */
export function portalFulfillmentProgressPercent(fulfillment: PortalOrderFulfillment): number {
  if (fulfillment.requestedQuantity <= 0) return 0;
  const raw = (fulfillment.fulfilledQuantity / fulfillment.requestedQuantity) * 100;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 100);
}

export function portalFulfillmentPrimarySummary(fulfillment: PortalOrderFulfillment): string {
  return `${fulfillment.fulfilledQuantity} of ${fulfillment.requestedQuantity} delivered`;
}
