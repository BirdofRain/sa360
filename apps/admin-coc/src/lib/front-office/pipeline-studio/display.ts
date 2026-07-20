import type {
  DestinationType,
  PipelineStudioKpiTone,
  PipelineStudioMetricCard,
  PipelineStudioReadModel,
  RouteKind,
  TerritoryPriority,
} from "./types";

export const PS_PRIORITY_DISPLAY: Record<
  TerritoryPriority,
  { label: string; className: string }
> = {
  high: {
    label: "Priority: High",
    className: "text-[var(--ps-blue)]",
  },
  medium: {
    label: "Priority: Medium",
    className: "text-teal-300",
  },
  low: {
    label: "Priority: Low",
    className: "text-[var(--ps-muted)]",
  },
};

export const PS_ROUTE_DISPLAY: Record<
  RouteKind,
  { label: string; stroke: string; dasharray?: string }
> = {
  primary: {
    label: "Primary",
    stroke: "var(--ps-blue)",
  },
  failover: {
    label: "Failover",
    stroke: "var(--ps-purple)",
    dasharray: "6 4",
  },
  backup: {
    label: "Backup",
    stroke: "var(--ps-muted)",
    dasharray: "2 4",
  },
};

export const PS_KPI_TONE_CLASS: Record<PipelineStudioKpiTone, string> = {
  good: "text-[var(--ps-green)]",
  warn: "text-amber-300",
  neutral: "text-[var(--ps-text)]",
  accent: "text-[var(--ps-blue)]",
};

export const DESTINATION_TYPE_LABEL: Record<DestinationType, string> = {
  crm: "Primary CRM Integration",
  power_dialer: "Voice Outreach",
  auto_follow_up: "Email + SMS Workflow",
};

export function formatLeadsPerDay(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function isTerritoryInteractive(
  territory: PipelineStudioReadModel["territories"][number]
): boolean {
  return territory.availableCount > 0 && territory.health !== "unavailable";
}

/** Derive metrics-strip cards from the authoritative read model (no ad hoc fixture imports in UI). */
export function buildMetricsStrip(model: PipelineStudioReadModel): PipelineStudioMetricCard[] {
  const selected = model.territories.filter((t) => t.selected);
  const estLeads = selected.reduce((sum, t) => sum + t.estimatedLeadsPerDay, 0);
  return [
    {
      key: "leadsPerDay",
      label: "Leads / Day (Est.)",
      value: formatLeadsPerDay(estLeads),
      trend: "+18.6%",
      tone: "accent",
    },
    {
      key: "coverage",
      label: "Coverage",
      value: `${selected.length} States`,
      detail: "28 Markets",
      tone: "neutral",
    },
    {
      key: "speedToLead",
      label: "Avg. Speed to Lead",
      value: `${model.metrics.averageSpeedToLeadSeconds} sec`,
      detail: `Goal: < ${model.rules.speedToLeadTargetSeconds} sec`,
      tone: "good",
    },
    {
      key: "routeHealth",
      label: "Route Health",
      value: model.metrics.routeHealth,
      detail: `${formatPercent(model.metrics.successRate)} success`,
      tone: "good",
    },
    {
      key: "connections",
      label: "Live Connections",
      value: String(model.metrics.activeConnectionCount),
      detail: `${formatPercent(model.compliance.proofCoveragePercent / 100)} proof coverage`,
      tone: "neutral",
    },
  ];
}
