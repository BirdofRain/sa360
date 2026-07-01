import {
  listLeadDeliveryReadModel,
  type LeadDeliveryReadServiceDeps,
} from "../lead-delivery/lead-delivery-read.service.js";
import { presentLeadDeliveryListRow } from "../lead-delivery/lead-delivery-present.service.js";
import { resolveAutomationDashboardDateRange } from "../../schemas/automation-dashboard.schema.js";
import { getAutomationDashboardSummary } from "../automation-dashboard.service.js";
import {
  buildFrontOfficeTrustCenter,
  summarizeTrust,
  type FrontOfficeTrustServiceDeps,
} from "./front-office-trust.service.js";
import type {
  FrontOfficeAudience,
  FrontOfficeDataSource,
  FrontOfficeRecentLeadDelivery,
  FrontOfficeSummaryKpis,
  FrontOfficeSummaryResponse,
  FrontOfficeUrgentTask,
} from "./front-office.types.js";

export type FrontOfficeSummaryServiceDeps = LeadDeliveryReadServiceDeps &
  FrontOfficeTrustServiceDeps & {
    listLeadDeliveryReadModelImpl?: typeof listLeadDeliveryReadModel;
    getAutomationDashboardSummaryImpl?: typeof getAutomationDashboardSummary;
    buildFrontOfficeTrustCenterImpl?: typeof buildFrontOfficeTrustCenter;
  };

function mapDeliveryStatusToFeedStatus(
  status: string
): FrontOfficeRecentLeadDelivery["status"] {
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

function buildUrgentTasks(
  rows: ReturnType<typeof presentLeadDeliveryListRow>[],
  trustCards: Awaited<ReturnType<typeof buildFrontOfficeTrustCenter>>["cards"]
): FrontOfficeUrgentTask[] {
  const tasks: FrontOfficeUrgentTask[] = [];
  const now = Date.now();

  for (const row of rows.filter((r) => r.deliveryStatus === "failed").slice(0, 3)) {
    tasks.push({
      id: `delivery-fail-${row.id}`,
      title: `Delivery failed — ${row.leadName ?? "Lead"} (${row.matchedClient ?? "Unmatched"})`,
      severity: "critical",
      href: `/front-office/lead-delivery?lead=${row.id}`,
      at: row.lastEventAt ?? row.receivedAt,
    });
  }

  for (const card of trustCards.filter((c) => c.status === "failed" || c.status === "warning").slice(0, 2)) {
    tasks.push({
      id: `trust-${card.key}`,
      title: `${card.title} needs attention — ${card.summary.slice(0, 80)}`,
      severity: card.status === "failed" ? "critical" : "high",
      href: "/front-office/trust",
      at: card.lastCheckedAt ?? new Date(now).toISOString(),
    });
  }

  for (const row of rows.filter((r) => r.routingStatus === "unmatched").slice(0, 2)) {
    tasks.push({
      id: `unmatched-${row.id}`,
      title: `Unmatched lead — ${row.leadName ?? "Unknown"} requires routing review`,
      severity: "medium",
      href: "/front-office/lead-delivery",
      at: row.receivedAt,
    });
  }

  return tasks.slice(0, 6);
}

function buildRecentLeadDelivery(
  rows: ReturnType<typeof presentLeadDeliveryListRow>[]
): FrontOfficeRecentLeadDelivery[] {
  return rows.slice(0, 8).map((row) => ({
    id: row.id,
    leadName: row.leadName ?? "Unknown lead",
    clientName: row.matchedClient ?? row.clientDisplayName ?? "Unmatched",
    status: mapDeliveryStatusToFeedStatus(row.deliveryStatus),
    at: row.lastEventAt ?? row.receivedAt,
    campaign: row.campaignName ?? row.sourcePlatform ?? "—",
    routingStatus: row.routingStatus,
    deliveryStatus: row.deliveryStatus,
  }));
}

function buildKpis(
  rows: ReturnType<typeof presentLeadDeliveryListRow>[],
  automation: Awaited<ReturnType<typeof getAutomationDashboardSummary>> | null,
  trustWarningCount: number
): FrontOfficeSummaryKpis {
  const latestLeadEvent = rows.reduce<string | null>((max, row) => {
    const at = row.lastEventAt ?? row.receivedAt;
    return !max || at > max ? at : max;
  }, null);

  return {
    leadsReceived: rows.length,
    leadsMatched: rows.filter(
      (r) => r.routingStatus === "matched" || r.routingStatus === "ready" || r.routingStatus === "dry_run"
    ).length,
    leadsDelivered: rows.filter((r) => r.deliveryStatus === "delivered").length,
    deliveryFailures: rows.filter((r) => r.deliveryStatus === "failed").length,
    appointmentsSet: automation?.appointmentsSet ?? 0,
    soldLogged: automation?.outcomeLogged ?? 0,
    trustWarnings: trustWarningCount,
    latestLeadEvent,
  };
}

function resolveSummaryDataSource(
  leadRows: ReturnType<typeof presentLeadDeliveryListRow>[],
  trustSource: FrontOfficeDataSource,
  hasAutomation: boolean
): FrontOfficeDataSource {
  const hasLeadData = leadRows.length > 0;
  if (hasLeadData && trustSource === "live" && hasAutomation) return "live";
  if (hasLeadData || trustSource !== "mock" || hasAutomation) return "partial_live";
  return "mock";
}

export async function buildFrontOfficeSummary(
  clientAccountId: string | undefined,
  audience: FrontOfficeAudience = "admin",
  deps: FrontOfficeSummaryServiceDeps = {}
): Promise<Omit<FrontOfficeSummaryResponse, "ok">> {
  const now = new Date().toISOString();
  const listLeads = deps.listLeadDeliveryReadModelImpl ?? listLeadDeliveryReadModel;
  const getAutomation = deps.getAutomationDashboardSummaryImpl ?? getAutomationDashboardSummary;
  const buildTrust = deps.buildFrontOfficeTrustCenterImpl ?? buildFrontOfficeTrustCenter;

  const signalRange = resolveAutomationDashboardDateRange({ range: "7d" });

  const [leadResult, automation, trustCenter] = await Promise.all([
    listLeads(
      {
        limit: 100,
        clientAccountIdResolved: clientAccountId,
      },
      deps
    ).catch(() => ({ items: [], nextCursor: null })),
    getAutomation({
      clientAccountId,
      from: signalRange.from,
      to: signalRange.to,
    }).catch(() => null),
    buildTrust(clientAccountId, deps).catch(() => ({
      generatedAt: now,
      dataSource: "mock" as const,
      cards: [],
    })),
  ]);

  const rows = leadResult.items.map((ctx) =>
    presentLeadDeliveryListRow(ctx, audience === "client" ? "client" : "admin")
  );
  const trustSummary = summarizeTrust(trustCenter.cards);
  const kpis = buildKpis(rows, automation, trustSummary.warningCount);

  return {
    generatedAt: now,
    dataSource: resolveSummaryDataSource(rows, trustCenter.dataSource, Boolean(automation)),
    kpis,
    urgentTasks: buildUrgentTasks(rows, trustCenter.cards),
    recentLeadDelivery: buildRecentLeadDelivery(rows),
    trustSummary,
  };
}
