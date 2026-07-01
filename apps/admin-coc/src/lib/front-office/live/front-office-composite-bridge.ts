import type {
  CompositeSummaryResponse,
  CompositeTrustCard,
  CompositeTrustResponse,
} from "@/lib/front-office-composite/types";
import type {
  FrontOfficeDashboardResponse,
  TrustCheckCard,
  TrustCenterResponse,
} from "../types";

export function mapCompositeTrustToFrontOffice(
  composite: CompositeTrustResponse
): TrustCenterResponse {
  return {
    dataSource: composite.dataSource,
    cards: composite.cards.map(
      (card): TrustCheckCard => ({
        key: card.key as TrustCheckCard["key"],
        label: card.title,
        status: card.status,
        headline: card.summary,
        lastCheckedAt: card.lastCheckedAt ?? composite.generatedAt,
        source: card.source === "partial_live" ? "live" : card.source,
        checks: card.details.map((d) => ({
          id: d.id,
          label: d.label,
          status: d.status,
          detail: d.detail,
          source: card.source === "mock" ? "mock" : "live",
          adminOnly: d.adminOnly,
          adminDetail: d.adminDetail,
        })),
      })
    ),
  };
}

export function mapCompositeSummaryToDashboard(
  composite: CompositeSummaryResponse,
  mockBase: FrontOfficeDashboardResponse
): FrontOfficeDashboardResponse {
  const { kpis } = composite;
  const mappedKpis = mockBase.kpis.map((kpi) => {
    switch (kpi.key) {
      case "leadsDelivered":
        return { ...kpi, value: kpis.leadsDelivered, tone: "good" as const };
      case "appointmentsBooked":
        return { ...kpi, value: kpis.appointmentsSet, tone: "good" as const };
      case "soldIssued":
        if (composite.dataSource !== "mock" && (kpis.ordersPaused ?? 0) > 0) {
          return { ...kpi, label: "Paused Orders", value: kpis.ordersPaused ?? 0 };
        }
        return { ...kpi, value: kpis.soldLogged, tone: "good" as const };
      case "deliveryFailures":
        return { ...kpi, value: kpis.deliveryFailures, tone: kpis.deliveryFailures > 0 ? ("bad" as const) : kpi.tone };
      case "trustScore":
        return {
          ...kpi,
          value: Math.max(0, 100 - kpis.trustWarnings * 5),
          delta: `${kpis.trustWarnings} trust warning(s)`,
        };
      case "liveTransfers":
        if (composite.dataSource !== "mock" && (kpis.ordersSubmitted ?? 0) > 0) {
          return { ...kpi, label: "New Orders", value: kpis.ordersSubmitted ?? 0 };
        }
        return composite.dataSource !== "mock"
          ? { ...kpi, label: "Leads Received", value: kpis.leadsReceived }
          : kpi;
      case "pickupRate":
        if (composite.dataSource !== "mock" && (kpis.ordersNeedingSetup ?? 0) > 0) {
          return {
            ...kpi,
            label: "Orders Needing Setup",
            value: kpis.ordersNeedingSetup ?? 0,
            tone: "warn" as const,
          };
        }
        return composite.dataSource !== "mock"
          ? {
              ...kpi,
              label: "Leads Matched",
              value: kpis.leadsMatched,
              delta: kpis.latestLeadEvent
                ? `Latest: ${new Date(kpis.latestLeadEvent).toLocaleString()}`
                : undefined,
            }
          : { ...kpi, value: "—", delta: "Unavailable without live match data" };
      case "showRate":
        if (composite.dataSource !== "mock" && (kpis.ordersActive ?? 0) > 0) {
          return { ...kpi, label: "Active Orders", value: kpis.ordersActive ?? 0, tone: "good" as const };
        }
        return { ...kpi, value: "—", delta: "Show rate not computed in operational demo v1" };
      default:
        return kpi;
    }
  });

  return {
    ...mockBase,
    generatedAt: composite.generatedAt,
    dataSource: composite.dataSource === "partial_live" ? "partial_live" : composite.dataSource,
    kpis: mappedKpis,
    urgentTasks: composite.urgentTasks,
    recentDeliveries: composite.recentLeadDelivery.map((row) => ({
      id: row.id,
      leadName: row.leadName,
      clientName: row.clientName,
      status: row.status,
      at: row.at,
      campaign: row.campaign,
    })),
  };
}

export function isCompositeTrustUsable(cards: CompositeTrustCard[]): boolean {
  return cards.some((c) => c.source !== "mock");
}

export function isCompositeSummaryUsable(composite: CompositeSummaryResponse): boolean {
  return composite.dataSource !== "mock";
}
