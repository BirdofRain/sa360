const ORDER_STATUSES = [
  "draft",
  "submitted",
  "needs_setup",
  "needs_compliance",
  "ready",
  "active",
  "paused",
  "completed",
  "canceled",
] as const;

export type PortalOrderStatus = (typeof ORDER_STATUSES)[number];

export type PortalOrderView = {
  id: string;
  orderNumber: string;
  status: PortalOrderStatus;
  nicheLabel: string;
  productLabel: string | null;
  statesLabel: string;
  volume: number;
  campaignType: string;
  destination: string;
  fulfillmentSummary: string | null;
  setupWarnings: string[];
  createdAt: string;
};

export type PortalOrderDetailView = PortalOrderView & {
  states: string[];
  deliveryCadence: string | null;
  crmPackage: string | null;
  aiVoiceAddon: boolean;
  requestedStartDate: string | null;
  destinationType: string | null;
  notes: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  updatedAt: string | null;
  fulfillmentSummaryIsPlaceholder: boolean;
};

/** Backend present-layer placeholder — do not treat as real fulfillment progress. */
export const PORTAL_ORDER_FULFILLMENT_PLACEHOLDER =
  "Fulfillment tracking will appear here once delivery is linked.";

const STATUS_SET = new Set<string>(ORDER_STATUSES);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function portalOrderStatusLabel(status: PortalOrderStatus): string {
  switch (status) {
    case "needs_setup":
      return "Needs setup";
    case "needs_compliance":
      return "Needs review";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function portalOrderStatusTone(
  status: PortalOrderStatus
): "good" | "warn" | "bad" | "neutral" {
  if (status === "active" || status === "completed" || status === "ready") return "good";
  if (status === "needs_setup" || status === "needs_compliance" || status === "paused") {
    return "warn";
  }
  if (status === "canceled") return "bad";
  return "neutral";
}

export function mapClientLeadOrderRow(raw: unknown): PortalOrderView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id);
  const statusRaw = asString(row.status);
  if (!id || !statusRaw || !STATUS_SET.has(statusRaw)) return null;
  const status = statusRaw as PortalOrderStatus;
  const states = Array.isArray(row.states)
    ? row.states.map((s) => asString(s)).filter((s): s is string => Boolean(s))
    : [];
  const warnings = Array.isArray(row.setupWarnings)
    ? row.setupWarnings.map((w) => asString(w)).filter((w): w is string => Boolean(w))
    : [];

  return {
    id,
    orderNumber: asString(row.orderNumber) ?? id,
    status,
    nicheLabel: formatLabel(asString(row.nicheKey) ?? "—"),
    productLabel: asString(row.productType) ? formatLabel(asString(row.productType)!) : null,
    statesLabel: states.length ? states.join(", ") : "—",
    volume: typeof row.leadVolume === "number" && Number.isFinite(row.leadVolume) ? row.leadVolume : 0,
    campaignType: formatLabel(asString(row.campaignType) ?? "—"),
    destination: asString(row.deliveryDestinationLabel) ?? "—",
    fulfillmentSummary: asString(row.fulfillmentSummary),
    setupWarnings: warnings,
    createdAt: asString(row.createdAt) ?? asString(row.submittedAt) ?? "",
  };
}

export function mapClientLeadOrderRows(items: unknown[]): PortalOrderView[] {
  return items.map(mapClientLeadOrderRow).filter((row): row is PortalOrderView => row !== null);
}

export function isPortalOrderFulfillmentPlaceholder(value: string | null): boolean {
  if (!value) return true;
  return value.trim() === PORTAL_ORDER_FULFILLMENT_PLACEHOLDER;
}

export function formatPortalDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function portalOrderNextStep(order: {
  status: PortalOrderStatus;
  setupWarnings: string[];
}): string {
  switch (order.status) {
    case "draft":
      return "This order is still a draft. Your SA360 team will submit it when it is ready.";
    case "submitted":
      return "Your order has been submitted. Your SA360 team will review it next.";
    case "needs_setup":
      return (
        order.setupWarnings[0] ??
        "Account setup is still needed before fulfillment can begin."
      );
    case "needs_compliance":
      return (
        order.setupWarnings[0] ??
        "A compliance review is required before this order can go live."
      );
    case "ready":
      return "This order is ready. Fulfillment starts once your SA360 team activates it.";
    case "active":
      return "This order is active. Your SA360 team is working on the requested leads.";
    case "paused":
      return "This order is paused. Contact your SA360 team if you have questions.";
    case "completed":
      return "This order is complete.";
    case "canceled":
      return "This order was canceled. Contact your SA360 team if you have questions.";
  }
}

export function mapClientLeadOrderDetail(raw: unknown): PortalOrderDetailView | null {
  const base = mapClientLeadOrderRow(raw);
  if (!base) return null;
  const row = asRecord(raw);
  if (!row) return null;

  const states = Array.isArray(row.states)
    ? row.states.map((s) => asString(s)).filter((s): s is string => Boolean(s))
    : [];
  const summary = asString(row.fulfillmentSummary);

  return {
    ...base,
    states,
    deliveryCadence: asString(row.deliveryCadence),
    crmPackage: asString(row.crmPackage) ? formatLabel(asString(row.crmPackage)!) : null,
    aiVoiceAddon: row.aiVoiceAddon === true,
    requestedStartDate: asString(row.requestedStartDate),
    destinationType: asString(row.deliveryDestinationType)
      ? formatLabel(asString(row.deliveryDestinationType)!)
      : null,
    notes: asString(row.notes),
    submittedAt: asString(row.submittedAt),
    approvedAt: asString(row.approvedAt),
    activatedAt: asString(row.activatedAt),
    pausedAt: asString(row.pausedAt),
    completedAt: asString(row.completedAt),
    canceledAt: asString(row.canceledAt),
    updatedAt: asString(row.updatedAt),
    fulfillmentSummaryIsPlaceholder: isPortalOrderFulfillmentPlaceholder(summary),
  };
}
