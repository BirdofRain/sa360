export type CompositeTrustStatus =
  | "verified"
  | "warning"
  | "needs_setup"
  | "failed"
  | "not_connected"
  | "mock";

export type CompositeDataSource = "live" | "partial_live" | "mock";

export type CompositeTrustDetail = {
  id: string;
  label: string;
  status: CompositeTrustStatus;
  detail: string;
  adminDetail?: string;
  adminOnly?: boolean;
};

export type CompositeTrustCard = {
  key: string;
  title: string;
  status: CompositeTrustStatus;
  source: CompositeDataSource;
  summary: string;
  lastCheckedAt: string | null;
  warnings: string[];
  details: CompositeTrustDetail[];
};

export type CompositeTrustResponse = {
  ok: boolean;
  generatedAt: string;
  dataSource: CompositeDataSource;
  cards: CompositeTrustCard[];
};

export type CompositeSummaryKpis = {
  leadsReceived: number;
  leadsMatched: number;
  leadsDelivered: number;
  deliveryFailures: number;
  appointmentsSet: number;
  soldLogged: number;
  trustWarnings: number;
  latestLeadEvent: string | null;
};

export type CompositeSummaryResponse = {
  ok: boolean;
  generatedAt: string;
  dataSource: CompositeDataSource;
  kpis: CompositeSummaryKpis;
  urgentTasks: Array<{
    id: string;
    title: string;
    severity: "critical" | "high" | "medium";
    href?: string;
    at: string;
  }>;
  recentLeadDelivery: Array<{
    id: string;
    leadName: string;
    clientName: string;
    status: "pending" | "in_progress" | "delivered" | "failed" | "skipped";
    at: string;
    campaign: string;
    routingStatus?: string;
    deliveryStatus?: string;
  }>;
  trustSummary: {
    status: CompositeTrustStatus;
    warningCount: number;
    cardsNeedingAttention: string[];
  };
};
