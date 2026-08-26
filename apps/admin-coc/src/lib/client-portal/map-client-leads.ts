import { formatPortalDisplayLabel } from "./portal-labels.ts";

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

export type PortalLeadTimelineStatus = "complete" | "pending" | "failed" | "skipped";

export type PortalLeadTimelineItem = {
  milestone: string;
  milestoneLabel: string;
  at: string | null;
  status: PortalLeadTimelineStatus;
  detail: string | null;
};

export type PortalLeadDetailView = PortalLeadView & {
  emailMasked: string | null;
  lastEventAt: string | null;
  soldStatus: string | null;
  routingStatus: string | null;
  routingLabel: string | null;
  matchedClient: string | null;
  workflowStarted: boolean | null;
  lifecycleStage: string | null;
  funnelName: string | null;
  adName: string | null;
  deliveredAt: string | null;
  approvedAt: string | null;
  warnings: string[];
  errorSummary: string | null;
  timeline: PortalLeadTimelineItem[];
};

const TIMELINE_STATUSES = new Set<PortalLeadTimelineStatus>([
  "complete",
  "pending",
  "failed",
  "skipped",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatLabel(value: string): string {
  return formatPortalDisplayLabel(value) || value.replace(/_/g, " ");
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

export function portalRoutingStatusLabel(status: string): string {
  switch (status) {
    case "matched":
      return "Matched";
    case "unmatched":
      return "Not matched";
    case "review_required":
      return "Needs review";
    case "dry_run":
      return "In review";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "unknown":
      return "Unknown";
    default:
      return formatLabel(status);
  }
}

export function portalLeadTimelineLabel(milestone: string): string {
  switch (milestone) {
    case "source_lead_received":
      return "Received";
    case "lead_created":
      return "Created";
    case "lead_matched":
      return "Matched";
    case "lead_routed":
      return "Routed";
    case "lead_delivery_started":
      return "Delivery started";
    case "lead_delivered":
      return "Delivered";
    case "client_contact_created":
      return "Contact created";
    case "client_workflow_started":
      return "Follow-up started";
    case "first_touch_sent":
      return "First outreach";
    case "contact_replied":
      return "Reply received";
    case "appointment_set":
      return "Appointment set";
    case "appointment_showed":
      return "Appointment showed";
    case "sold":
      return "Sold";
    default:
      return formatLabel(milestone);
  }
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

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

function mapTimelineItem(raw: unknown): PortalLeadTimelineItem | null {
  const row = asRecord(raw);
  if (!row) return null;
  const milestone = asString(row.milestone);
  const statusRaw = asString(row.status);
  if (!milestone || !statusRaw || !TIMELINE_STATUSES.has(statusRaw as PortalLeadTimelineStatus)) {
    return null;
  }
  const at = asString(row.at);
  if (!at && statusRaw !== "failed") return null;
  return {
    milestone,
    milestoneLabel: portalLeadTimelineLabel(milestone),
    at,
    status: statusRaw as PortalLeadTimelineStatus,
    detail: asString(row.detail),
  };
}

export function mapClientLeadDeliveryDetail(raw: unknown): PortalLeadDetailView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id);
  if (!id) return null;
  const base = mapClientLeadDeliveryRow({ ...row, id });
  if (!base) return null;

  const attribution = asRecord(row.attribution);
  const delivery = asRecord(row.delivery);
  const lifecycle = asRecord(row.lifecycle);
  const routingStatus = asString(row.routingStatus);

  return {
    ...base,
    emailMasked: asString(row.emailMasked),
    lastEventAt: asString(row.lastEventAt),
    soldStatus: asString(row.soldStatus),
    routingStatus,
    routingLabel: routingStatus ? portalRoutingStatusLabel(routingStatus) : null,
    matchedClient: asString(row.matchedClient),
    workflowStarted: row.workflowStarted === true ? true : row.workflowStarted === false ? false : null,
    lifecycleStage: asString(lifecycle?.lifecycleStage),
    funnelName: asString(attribution?.sourceFunnelName),
    adName: asString(row.adName) ?? asString(attribution?.adName),
    deliveredAt: asString(delivery?.deliveredAt),
    approvedAt: asString(delivery?.approvedAt),
    warnings: asStringList(row.warnings),
    errorSummary: asString(row.errorSummary),
    timeline: Array.isArray(row.timeline)
      ? row.timeline.map(mapTimelineItem).filter((item): item is PortalLeadTimelineItem => item !== null)
      : [],
  };
}
