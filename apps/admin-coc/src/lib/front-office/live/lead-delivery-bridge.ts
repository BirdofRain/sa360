import type { UnifiedLeadDeliveryDetail, UnifiedLeadDeliveryListRow } from "@/lib/lead-delivery-read-model/types";
import type { SourceLeadDetail, SourceLeadListItem } from "@/lib/source-intake/types";

import type {
  DeliveryStatus,
  FrontOfficeRole,
  LeadDeliveryDetail,
  LeadDeliveryListResponse,
  LeadDeliveryRow,
  LeadDeliveryTimelineEntry,
} from "../types";
import type { LiveBridgeScope } from "./config";
import { maskEmail, maskPhone, safeClientLabel } from "./mask";
import { buildTimelineFromSourceLeadAndTimeline } from "./timeline-mapper";
import type { AdminLeadTimelineResponse } from "@/lib/admin-api/types";

export function mapUnifiedDeliveryStatus(status: string): DeliveryStatus {
  switch (status) {
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "simulated":
    case "pending":
    case "partial":
      return "in_progress";
    default:
      return "pending";
  }
}

export function mapUnifiedRowToFrontOffice(
  item: UnifiedLeadDeliveryListRow,
  role: FrontOfficeRole
): LeadDeliveryRow {
  const sourcePlatform = item.sourcePlatform;
  const sourceType = item.sourceType;
  return {
    leadUid: item.id,
    receivedAt: item.receivedAt,
    leadName: item.leadName?.trim() || "Unknown lead",
    phoneMasked: item.phoneMasked ?? maskPhone(item.phoneE164, role),
    emailMasked: item.emailMasked ?? maskEmail(item.email, role),
    source: `${sourcePlatform} · ${sourceType}`,
    sourcePlatform,
    sourceType,
    campaign: item.campaignName ?? item.campaignId ?? sourcePlatform,
    campaignName: item.campaignName ?? undefined,
    matchedClient: item.matchedClient
      ? role === "client"
        ? safeClientLabel(item.clientDisplayName ?? item.clientAccountId)
        : (item.clientDisplayName ?? item.clientAccountId ?? item.matchedClient)
      : "Unmatched",
    clientAccountId: item.clientAccountId ?? undefined,
    routingStatus: item.routingStatus,
    deliveryStatus: mapUnifiedDeliveryStatus(item.deliveryStatus),
    lastEvent: item.lastEventName ?? item.lastEventAt ?? undefined,
    errorSummary: item.errorSummary ?? undefined,
    error: item.errorSummary ?? undefined,
    ghlContact:
      item.ghlContactStatus === "created" || item.ghlContactStatus === "updated"
        ? "created"
        : item.ghlContactStatus === "not_created"
          ? "n/a"
          : undefined,
    workflowStarted: item.workflowStarted ?? undefined,
    appointmentStatus:
      item.appointmentStatus === "set"
        ? "set"
        : item.appointmentStatus === "showed"
          ? "showed"
          : item.appointmentStatus === "no_show"
            ? "no_show"
            : "none",
    soldStatus:
      item.soldStatus === "sold" || item.soldStatus === "issued"
        ? "sold"
        : "none",
  };
}

export function mapUnifiedTimeline(
  timeline: UnifiedLeadDeliveryDetail["timeline"]
): LeadDeliveryTimelineEntry[] {
  return timeline.map((entry) => ({
    milestone: entry.milestone as LeadDeliveryTimelineEntry["milestone"],
    at: entry.at,
    status: entry.status as LeadDeliveryTimelineEntry["status"],
    detail: entry.detail,
  }));
}

export function resolveListDataSource(
  items: UnifiedLeadDeliveryListRow[]
): LeadDeliveryListResponse["dataSource"] {
  if (!items.length) return "live";
  const sources = new Set(items.map((i) => i.dataSource));
  if (sources.size === 1 && sources.has("live")) return "live";
  if (sources.has("partial_live")) return "partial_live";
  return "live";
}

export function mapSourceStatusToDelivery(status: string): DeliveryStatus {
  const s = status.toLowerCase();
  if (s === "delivered") return "delivered";
  if (s === "failed" || s === "rejected") return "failed";
  if (s === "routing_unmatched") return "skipped";
  if (s === "approved" || s === "routing_matched" || s === "delivery_running") {
    return "in_progress";
  }
  return "pending";
}

export function mapSourceLeadToRow(item: SourceLeadListItem, role: FrontOfficeRole): LeadDeliveryRow {
  const sourcePlatform = item.sourceProvider || item.sourceSystem;
  const sourceType = item.sourceType;
  return {
    leadUid: item.id,
    receivedAt: item.receivedAt,
    leadName: item.leadName?.trim() || "Unknown lead",
    phoneMasked: maskPhone(item.phone, role),
    emailMasked: maskEmail(item.email, role),
    source: `${sourcePlatform} · ${sourceType}`,
    sourcePlatform,
    sourceType,
    campaign: item.sourceRouteKey ?? item.sourceSystem,
    campaignName: item.sourceRouteKey ?? undefined,
    matchedClient: item.destinationClientAccountId
      ? role === "client"
        ? safeClientLabel(item.destinationClientAccountId)
        : item.destinationClientAccountId
      : "Unmatched",
    clientAccountId: item.destinationClientAccountId ?? undefined,
    routingStatus: item.matched ? "matched" : "unmatched",
    deliveryStatus: mapSourceStatusToDelivery(item.status),
    lastEvent: item.status.replace(/_/g, " "),
    errorSummary: item.errorSummary ?? undefined,
    error: item.errorSummary ?? undefined,
  };
}

export function mapDetailToRow(detail: SourceLeadDetail, role: FrontOfficeRole): LeadDeliveryRow {
  return {
    ...mapSourceLeadToRow(detail, role),
    campaign: detail.sourceCampaignName ?? detail.sourceRouteKey ?? detail.sourceSystem,
    campaignName: detail.sourceCampaignName ?? undefined,
  };
}

export type LeadDeliveryFetchers = {
  fetchUnifiedList: (params: Record<string, string>) => Promise<{
    items: UnifiedLeadDeliveryListRow[];
    error: string | null;
  }>;
  fetchUnifiedDetail: (id: string) => Promise<{
    item: UnifiedLeadDeliveryDetail | null;
    error: string | null;
  }>;
  fetchLegacyList: (params: Record<string, string>) => Promise<{
    items: SourceLeadListItem[];
    error: string | null;
  }>;
  fetchLegacyDetail: (id: string) => Promise<{
    item: SourceLeadDetail | null;
    error: string | null;
  }>;
  fetchTimeline: (params: Record<string, string | number | undefined>) => Promise<{
    timeline: AdminLeadTimelineResponse | null;
  }>;
};

export async function getLeadDeliveryListUnifiedWithFetchers(
  scope: LiveBridgeScope,
  fetchers: LeadDeliveryFetchers
): Promise<LeadDeliveryListResponse | null> {
  const params: Record<string, string> = { limit: "50" };
  if (scope.clientAccountId) {
    params.clientAccountId = scope.clientAccountId;
  }

  const { items, error } = await fetchers.fetchUnifiedList(params);
  if (error) return null;
  return {
    rows: items.map((item) => mapUnifiedRowToFrontOffice(item, scope.role)),
    dataSource: resolveListDataSource(items),
  };
}

export async function getLeadDeliveryDetailUnifiedWithFetchers(
  leadUid: string,
  scope: LiveBridgeScope,
  fetchers: LeadDeliveryFetchers
): Promise<LeadDeliveryDetail | null> {
  const { item, error } = await fetchers.fetchUnifiedDetail(leadUid);
  if (error || !item) return null;

  if (
    scope.role === "client" &&
    scope.clientAccountId &&
    item.clientAccountId &&
    item.clientAccountId !== scope.clientAccountId
  ) {
    return null;
  }

  return {
    ...mapUnifiedRowToFrontOffice(item, scope.role),
    timeline: mapUnifiedTimeline(item.timeline),
  };
}

export async function getLeadDeliveryListLegacyWithFetchers(
  scope: LiveBridgeScope,
  fetchers: LeadDeliveryFetchers
): Promise<LeadDeliveryListResponse | null> {
  const params: Record<string, string> = { limit: "50" };
  if (scope.clientAccountId) {
    params.clientAccountIdResolved = scope.clientAccountId;
  }

  const { items, error } = await fetchers.fetchLegacyList(params);
  if (error || !items.length) return null;
  return {
    rows: items.map((item) => mapSourceLeadToRow(item, scope.role)),
    dataSource: "live",
  };
}

export async function getLeadDeliveryDetailLegacyWithFetchers(
  leadUid: string,
  scope: LiveBridgeScope,
  fetchers: LeadDeliveryFetchers
): Promise<LeadDeliveryDetail | null> {
  const { item, error } = await fetchers.fetchLegacyDetail(leadUid);
  if (error || !item) return null;

  if (
    scope.role === "client" &&
    scope.clientAccountId &&
    item.destinationClientAccountId &&
    item.destinationClientAccountId !== scope.clientAccountId
  ) {
    return null;
  }

  let timelineResponse = null;
  const clientAccountId = item.destinationClientAccountId ?? scope.clientAccountId ?? undefined;
  const timelineLeadUid = item.sourceLeadUid ?? undefined;

  if (clientAccountId && (timelineLeadUid || item.phone || item.email)) {
    const result = await fetchers.fetchTimeline({
      clientAccountId,
      leadUid: timelineLeadUid,
      phoneE164: item.phone ?? undefined,
      email: item.email ?? undefined,
      limit: 100,
    });
    timelineResponse = result.timeline;
  }

  const timeline = buildTimelineFromSourceLeadAndTimeline(item, timelineResponse);

  return {
    ...mapDetailToRow(item, scope.role),
    timeline,
  };
}

export async function getLeadDeliveryListLiveWithFetchers(
  scope: LiveBridgeScope,
  fetchers: LeadDeliveryFetchers
): Promise<LeadDeliveryListResponse | null> {
  const unified = await getLeadDeliveryListUnifiedWithFetchers(scope, fetchers);
  if (unified) return unified;
  return getLeadDeliveryListLegacyWithFetchers(scope, fetchers);
}

export async function getLeadDeliveryDetailLiveWithFetchers(
  leadUid: string,
  scope: LiveBridgeScope,
  fetchers: LeadDeliveryFetchers
): Promise<LeadDeliveryDetail | null> {
  const unified = await getLeadDeliveryDetailUnifiedWithFetchers(leadUid, scope, fetchers);
  if (unified) return unified;
  return getLeadDeliveryDetailLegacyWithFetchers(leadUid, scope, fetchers);
}
