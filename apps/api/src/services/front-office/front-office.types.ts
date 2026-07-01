export type FrontOfficeDataSource = "live" | "partial_live" | "mock";

export type FrontOfficeTrustStatus =
  | "verified"
  | "warning"
  | "needs_setup"
  | "failed"
  | "not_connected"
  | "mock";

export type FrontOfficeTrustCardKey =
  | "ghl_connection"
  | "delivery_readiness"
  | "required_fields"
  | "workflow_pipeline_config"
  | "webhook_health"
  | "routing_rule_readiness"
  | "signal_health"
  | "client_snapshot_readiness";

export const FRONT_OFFICE_TRUST_CARD_KEYS: FrontOfficeTrustCardKey[] = [
  "ghl_connection",
  "delivery_readiness",
  "required_fields",
  "workflow_pipeline_config",
  "webhook_health",
  "routing_rule_readiness",
  "signal_health",
  "client_snapshot_readiness",
];

export type FrontOfficeTrustDetail = {
  id: string;
  label: string;
  status: FrontOfficeTrustStatus;
  detail: string;
  adminDetail?: string;
  adminOnly?: boolean;
};

export type FrontOfficeTrustCard = {
  key: FrontOfficeTrustCardKey;
  title: string;
  status: FrontOfficeTrustStatus;
  source: FrontOfficeDataSource;
  summary: string;
  lastCheckedAt: string | null;
  warnings: string[];
  details: FrontOfficeTrustDetail[];
};

export type FrontOfficeTrustResponse = {
  ok: true;
  generatedAt: string;
  dataSource: FrontOfficeDataSource;
  cards: FrontOfficeTrustCard[];
};

export type FrontOfficeSummaryKpis = {
  leadsReceived: number;
  leadsMatched: number;
  leadsDelivered: number;
  deliveryFailures: number;
  appointmentsSet: number;
  soldLogged: number;
  trustWarnings: number;
  latestLeadEvent: string | null;
};

export type FrontOfficeUrgentTask = {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium";
  href?: string;
  at: string;
};

export type FrontOfficeRecentLeadDelivery = {
  id: string;
  leadName: string;
  clientName: string;
  status: "pending" | "in_progress" | "delivered" | "failed" | "skipped";
  at: string;
  campaign: string;
  routingStatus?: string;
  deliveryStatus?: string;
};

export type FrontOfficeTrustSummary = {
  status: FrontOfficeTrustStatus;
  warningCount: number;
  cardsNeedingAttention: string[];
};

export type FrontOfficeSummaryResponse = {
  ok: true;
  generatedAt: string;
  dataSource: FrontOfficeDataSource;
  kpis: FrontOfficeSummaryKpis;
  urgentTasks: FrontOfficeUrgentTask[];
  recentLeadDelivery: FrontOfficeRecentLeadDelivery[];
  trustSummary: FrontOfficeTrustSummary;
};

export type FrontOfficeDemoReadinessResponse = {
  ok: true;
  generatedAt: string;
  adminApiConfigured: boolean;
  leadDeliveryEndpointHealthy: boolean;
  trustEndpointHealthy: boolean;
  summaryEndpointHealthy: boolean;
  sourceLeadsPresent: boolean;
  latestTimelineAvailable: boolean;
  notes: string[];
};

export type FrontOfficeAudience = "admin" | "client";
