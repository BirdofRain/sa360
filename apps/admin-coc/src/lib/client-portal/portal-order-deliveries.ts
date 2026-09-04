import type { PortalOrderStatus } from "./map-client-orders.ts";
import type { PortalOrderFulfillmentStatus } from "./portal-order-fulfillment.ts";

export type PortalOrderDelivery = {
  id: string;
  orderId: string;
  filename: string;
  displayFilename: string;
  releasedAt: string;
  leadCount: number;
  downloadAvailable: boolean;
  downloadHref: string;
};

export type PortalOrderDeliverySectionState =
  | "hidden"
  | "finalizing"
  | "ready"
  | "empty"
  | "error";

export const PORTAL_ORDER_DELIVERY_FINALIZING_COPY =
  "Your spreadsheet is being finalized.";

export const PORTAL_ORDER_DELIVERY_READY_COPY = "Your delivery is ready.";

export const PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY =
  "No leads have been released yet.";

export const PORTAL_ORDER_DELIVERY_UNAVAILABLE_COPY =
  "A download is not available yet.";

export const PORTAL_ORDER_DELIVERY_LOAD_ERROR = "Delivery status could not be loaded.";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 0 ? n : null;
}

export function clientLeadOrderExportsPath(opts: {
  id: string;
  clientAccountId: string;
}): string {
  const params = new URLSearchParams({ clientAccountId: opts.clientAccountId });
  return `/client/v1/lead-orders/${encodeURIComponent(opts.id)}/exports?${params.toString()}`;
}

export function portalOrderDeliveryDownloadPath(orderId: string, exportId: string): string {
  return `/api/client-portal/orders/${encodeURIComponent(orderId)}/exports/${encodeURIComponent(exportId)}/download`;
}

export function parseClientLeadOrderExportsPayload(data: unknown): {
  items: unknown[];
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { items: [] };
  }
  const row = data as { items?: unknown };
  return { items: Array.isArray(row.items) ? row.items : [] };
}

export function mapClientReleasedDelivery(
  raw: unknown,
  orderId: string
): PortalOrderDelivery | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id);
  const releasedAt = asString(row.releasedAt);
  const filename = asString(row.displayFilename) ?? asString(row.filename);
  const leadCount = asNonNegativeInt(row.leadCount);
  const itemOrderId = asString(row.orderId) ?? orderId;
  if (!id || !releasedAt || !filename || leadCount == null) return null;
  if (row.downloadAvailable !== true) return null;
  if (itemOrderId !== orderId) return null;
  return {
    id,
    orderId: itemOrderId,
    filename,
    displayFilename: filename,
    releasedAt,
    leadCount,
    downloadAvailable: true,
    downloadHref: portalOrderDeliveryDownloadPath(itemOrderId, id),
  };
}

export function mapClientReleasedDeliveries(
  items: unknown[],
  orderId: string
): PortalOrderDelivery[] {
  return items
    .map((item) => mapClientReleasedDelivery(item, orderId))
    .filter((row): row is PortalOrderDelivery => row != null);
}

/**
 * Customer delivery copy must follow real package/release data.
 *
 * "Your spreadsheet is being finalized" is only valid when fulfillment is
 * already complete (`fulfilled`) and a successful exports lookup returned no
 * released package. Completed + 0 delivered + no package is not finalizing.
 */
export function portalOrderDeliverySectionState(input: {
  status: PortalOrderStatus;
  fulfillmentAvailable: boolean;
  fulfillmentStatus?: PortalOrderFulfillmentStatus | null;
  deliveries: PortalOrderDelivery[];
  deliveriesError?: string | null;
}): PortalOrderDeliverySectionState {
  if (input.deliveriesError) return "error";
  if (input.deliveries.length > 0) return "ready";
  if (input.fulfillmentStatus === "fulfilled") return "finalizing";
  if (
    input.fulfillmentAvailable ||
    input.status === "active" ||
    input.status === "completed" ||
    input.status === "paused"
  ) {
    return "empty";
  }
  return "hidden";
}

export function portalOrderDeliveryEmptyCopy(input: {
  status: PortalOrderStatus;
  fulfilledQuantity?: number | null;
}): string {
  const delivered = input.fulfilledQuantity ?? 0;
  if (input.status === "completed" && delivered === 0) {
    return PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY;
  }
  return PORTAL_ORDER_DELIVERY_UNAVAILABLE_COPY;
}
