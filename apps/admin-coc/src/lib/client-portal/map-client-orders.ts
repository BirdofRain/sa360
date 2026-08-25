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
