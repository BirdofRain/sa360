import type { FrontOfficeDashboardResponse, FrontOfficeRole } from "../types";

type LiveDashboardSlice = Partial<{
  appointmentsBooked: number;
  deliveryFailures: number;
  leadsDelivered: number;
}>;

export function mergeDashboard(
  mock: FrontOfficeDashboardResponse,
  live: LiveDashboardSlice,
  role: FrontOfficeRole
): FrontOfficeDashboardResponse {
  const kpis = mock.kpis.map((kpi) => {
    if (role === "client" && kpi.key === "liveTransfers") return kpi;
    if (kpi.key === "appointmentsBooked" && live.appointmentsBooked != null) {
      return { ...kpi, value: live.appointmentsBooked, tone: "good" as const };
    }
    if (kpi.key === "deliveryFailures" && live.deliveryFailures != null) {
      return { ...kpi, value: live.deliveryFailures };
    }
    if (kpi.key === "leadsDelivered" && live.leadsDelivered != null) {
      return { ...kpi, value: live.leadsDelivered, tone: "good" as const };
    }
    return kpi;
  });

  const hasLive = Object.keys(live).length > 0;
  return {
    ...mock,
    kpis,
    dataSource: hasLive ? "mixed" : "mock",
  };
}
