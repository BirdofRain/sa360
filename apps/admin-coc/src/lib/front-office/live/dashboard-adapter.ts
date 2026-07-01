import "server-only";

import { fetchAdminFrontOfficeSummary } from "@/lib/admin-api/server";

import { getMockDashboard } from "../mock/dashboard";
import type { FrontOfficeDashboardResponse } from "../types";
import type { FrontOfficeRole } from "../types";
import { mergeDashboard } from "../api/merge-dashboard";
import {
  isCompositeSummaryUsable,
  mapCompositeSummaryToDashboard,
} from "./front-office-composite-bridge";

export async function getDashboardComposite(
  role: FrontOfficeRole,
  clientAccountId?: string
): Promise<FrontOfficeDashboardResponse | null> {
  if (role !== "admin" && role !== "client") return null;

  const params: Record<string, string> = {};
  if (clientAccountId) params.clientAccountId = clientAccountId;

  try {
    const { data, error } = await fetchAdminFrontOfficeSummary(params);
    if (error || !data) return null;
    if (!isCompositeSummaryUsable(data) && data.recentLeadDelivery.length === 0) {
      return {
        ...mapCompositeSummaryToDashboard(data, getMockDashboard(role)),
        dataSource: "live",
        recentDeliveries: [],
        urgentTasks: data.urgentTasks,
      };
    }
    if (!isCompositeSummaryUsable(data)) return null;
    return mapCompositeSummaryToDashboard(data, getMockDashboard(role));
  } catch {
    return null;
  }
}

export async function getDashboardLegacy(role: FrontOfficeRole): Promise<FrontOfficeDashboardResponse> {
  const mock = getMockDashboard(role);

  if (role !== "admin") {
    return mock;
  }

  try {
    const { adminFetchJson } = await import("@/lib/admin-api/server");
    const [autoRes, lfRes] = await Promise.all([
      adminFetchJson<{ appointmentsSet?: number; webhookFailures?: number }>(
        "/admin/v1/automation-dashboard/summary"
      ),
      adminFetchJson<{
        kpis?: { key: string; value: number }[];
      }>("/admin/v1/coc/lead-fulfillment/overview"),
    ]);

    const live: Parameters<typeof mergeDashboard>[1] = {};
    if (autoRes.ok && autoRes.data?.appointmentsSet != null) {
      live.appointmentsBooked = autoRes.data.appointmentsSet;
    }
    if (autoRes.ok && autoRes.data?.webhookFailures != null) {
      live.deliveryFailures = autoRes.data.webhookFailures;
    }
    if (lfRes.ok && lfRes.data?.kpis) {
      const delivered = lfRes.data.kpis.find((k) => k.key === "deliveredLeads");
      if (delivered && delivered.value > 0) {
        live.leadsDelivered = delivered.value;
      }
    }

    return mergeDashboard(mock, live, role);
  } catch {
    return mock;
  }
}

export async function getDashboardLive(
  role: FrontOfficeRole,
  clientAccountId?: string
): Promise<FrontOfficeDashboardResponse> {
  const composite = await getDashboardComposite(role, clientAccountId);
  if (composite) return composite;
  const legacy = await getDashboardLegacy(role);
  if (legacy.dataSource !== "mock") return legacy;
  return getMockDashboard(role);
}
