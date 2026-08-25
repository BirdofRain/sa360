export type PortalLeadView = {
  id: string;
  leadName: string;
  phoneMasked: string | null;
  campaign: string;
  sourceLabel: string;
  receivedAt: string;
  deliveryStatus: string;
  deliveryLabel: string;
  lastEvent: string | null;
  appointmentStatus: string | null;
};

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

export function portalDeliveryStatusLabel(status: string): string {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "in_progress":
    case "simulated":
    case "partial":
      return "In progress";
    case "pending":
      return "Pending";
    default:
      return formatLabel(status);
  }
}

export function portalDeliveryStatusTone(
  status: string
): "good" | "warn" | "bad" | "neutral" {
  if (status === "delivered") return "good";
  if (status === "failed") return "bad";
  if (status === "pending" || status === "in_progress" || status === "partial") return "warn";
  return "neutral";
}

export function mapClientLeadDeliveryRow(raw: unknown): PortalLeadView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id) ?? asString(row.leadUid) ?? asString(row.sourceLeadId);
  if (!id) return null;
  const deliveryStatus = asString(row.deliveryStatus) ?? "pending";
  const sourcePlatform = asString(row.sourcePlatform);
  const sourceType = asString(row.sourceType);
  const sourceLabel = [sourcePlatform, sourceType].filter(Boolean).join(" · ") || "—";

  return {
    id,
    leadName: asString(row.leadName) ?? "Lead",
    phoneMasked: asString(row.phoneMasked),
    campaign: asString(row.campaignName) ?? asString(row.campaignId) ?? sourcePlatform ?? "—",
    sourceLabel,
    receivedAt: asString(row.receivedAt) ?? "",
    deliveryStatus,
    deliveryLabel: portalDeliveryStatusLabel(deliveryStatus),
    lastEvent: asString(row.lastEventName) ?? asString(row.lastEventAt),
    appointmentStatus: asString(row.appointmentStatus),
  };
}

export function mapClientLeadDeliveryRows(items: unknown[]): PortalLeadView[] {
  return items
    .map(mapClientLeadDeliveryRow)
    .filter((row): row is PortalLeadView => row !== null);
}
