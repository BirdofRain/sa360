export type FrontOfficeRole = "admin" | "client" | "agent";

export type FrontOfficeSession = {
  role: FrontOfficeRole;
  displayName: string;
  clientAccountId?: string;
  isDevPreview?: boolean;
};

export type AgentAvailability = "available" | "busy" | "offline";

export type FrontOfficeDataSource = "mock" | "live" | "partial_live" | "mixed";

export type FrontOfficeDashboardKpiKey =
  | "leadsDelivered"
  | "appointmentsBooked"
  | "liveTransfers"
  | "pickupRate"
  | "showRate"
  | "soldIssued"
  | "deliveryFailures"
  | "trustScore";

export type FrontOfficeKpiTone = "good" | "warn" | "bad" | "neutral";

export type FrontOfficeDashboardKpi = {
  key: FrontOfficeDashboardKpiKey;
  label: string;
  value: number | string;
  tone?: FrontOfficeKpiTone;
  delta?: string;
};

export type UrgentTaskSeverity = "critical" | "high" | "medium";

export type FrontOfficeUrgentTask = {
  id: string;
  title: string;
  severity: UrgentTaskSeverity;
  href?: string;
  at: string;
};

export type DeliveryStatus =
  | "pending"
  | "in_progress"
  | "delivered"
  | "failed"
  | "skipped";

export type RecentDeliveryEvent = {
  id: string;
  leadName: string;
  clientName: string;
  status: DeliveryStatus;
  at: string;
  campaign: string;
};

export type FrontOfficeDashboardResponse = {
  generatedAt: string;
  availability: AgentAvailability;
  kpis: FrontOfficeDashboardKpi[];
  urgentTasks: FrontOfficeUrgentTask[];
  recentDeliveries: RecentDeliveryEvent[];
  filters: {
    campaigns: string[];
    clients: string[];
    dateRanges: { key: string; label: string }[];
  };
  dataSource: FrontOfficeDataSource;
};

export type GhlContactStatus = "created" | "existing" | "failed" | "n/a";
export type FirstTouchStatus = "pending" | "sent" | "replied" | "failed";
export type AppointmentStatus = "none" | "set" | "showed" | "no_show";
export type SoldStatus = "none" | "quoted" | "sold" | "issued";

export type LeadDeliveryRow = {
  leadUid: string;
  receivedAt: string;
  leadName: string;
  phoneMasked: string;
  emailMasked?: string;
  /** Legacy combined source label */
  source: string;
  sourcePlatform?: string;
  sourceType?: string;
  campaign: string;
  campaignName?: string;
  matchedClient: string;
  clientAccountId?: string;
  routingStatus?: string;
  deliveryStatus: DeliveryStatus;
  lastEvent?: string;
  errorSummary?: string;
  /** Legacy mock columns — optional when live data is used */
  ghlContact?: GhlContactStatus;
  workflowStarted?: boolean;
  firstTouchStatus?: FirstTouchStatus;
  appointmentStatus?: AppointmentStatus;
  soldStatus?: SoldStatus;
  error?: string;
};

export type LeadDeliveryMilestone =
  | "source_lead_received"
  | "lead_created"
  | "lead_matched"
  | "lead_routed"
  | "lead_delivery_started"
  | "lead_delivered"
  | "client_contact_created"
  | "client_workflow_started"
  | "first_touch_sent"
  | "contact_replied"
  | "appointment_set"
  | "appointment_showed"
  | "sold";

export type MilestoneStatus = "complete" | "pending" | "failed" | "skipped";

export type LeadDeliveryTimelineEntry = {
  milestone: LeadDeliveryMilestone;
  at?: string;
  status: MilestoneStatus;
  detail?: string;
};

export type LeadDeliveryDetail = LeadDeliveryRow & {
  timeline: LeadDeliveryTimelineEntry[];
};

export type LeadDeliveryListResponse = {
  rows: LeadDeliveryRow[];
  dataSource: FrontOfficeDataSource;
};

export type OrderAdminStatus =
  | "needs_setup"
  | "needs_compliance"
  | "ready"
  | "active"
  | "paused";

export type LeadOrder = {
  id: string;
  clientName: string;
  niche: string;
  state: string;
  volume: number;
  campaignType: string;
  crmPackage: string;
  aiVoiceAddon: boolean;
  deliveryDestination: string;
  adminStatus: OrderAdminStatus;
  createdAt: string;
};

export type CreateLeadOrderInput = Omit<LeadOrder, "id" | "createdAt" | "adminStatus">;

export type LeadOrdersResponse = {
  orders: LeadOrder[];
  dataSource: FrontOfficeDataSource;
};

export type TrustCheckKey =
  | "ghl_connection"
  | "delivery_readiness"
  | "required_fields"
  | "workflow_pipeline_config"
  | "webhook_health"
  | "routing_rule_readiness"
  | "signal_health"
  | "client_snapshot_readiness";

export type TrustStatus =
  | "verified"
  | "warning"
  | "needs_setup"
  | "failed"
  | "not_connected"
  | "mock";

export type TrustCheckSource = "live" | "mock" | "unwired";

export type TrustCheckDetail = {
  id: string;
  label: string;
  status: TrustStatus;
  detail: string;
  source?: TrustCheckSource;
  /** Admin-only row — stripped for client role */
  adminOnly?: boolean;
  /** Expanded admin detail — never sent to client role */
  adminDetail?: string;
};

export type TrustCheckCard = {
  key: TrustCheckKey;
  label: string;
  status: TrustStatus;
  headline: string;
  lastCheckedAt: string;
  checks: TrustCheckDetail[];
  source?: TrustCheckSource;
};

export type TrustCenterResponse = {
  cards: TrustCheckCard[];
  dataSource: FrontOfficeDataSource;
};

export type DialDisposition =
  | "contacted"
  | "set_appointment"
  | "follow_up"
  | "bad_number"
  | "dnc"
  | "no_show"
  | "sold";

export type DialQueueItem = {
  leadUid: string;
  leadName: string;
  phoneMasked: string;
  priority: "hot" | "warm" | "standard";
  campaign: string;
  lastTouchAt?: string;
};

export type DialDeskContact = {
  leadUid: string;
  name: string;
  phoneMasked: string;
  email?: string;
  source: string;
  campaign: string;
  aiStatus: "engaged" | "idle" | "needs_human";
  timeline: { at: string; summary: string }[];
  notes: string[];
};

export type DialDeskResponse = {
  queue: DialQueueItem[];
  activeContact: DialDeskContact | null;
  dataSource: FrontOfficeDataSource;
};
