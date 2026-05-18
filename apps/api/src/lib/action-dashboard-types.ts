/**
 * Wire contract for GET /admin/v1/action-dashboard/today
 * (mirrored in admin-coc `AdminActionDashboardToday`).
 */

export type ActionDashboardConnectionStatus = "connected" | "degraded" | "disconnected";

export type ActionDashboardPriorityReasonCode =
  | "ai_appointment_ready"
  | "hot_lead"
  | "callback_due"
  | "revenue_signal"
  | "stale_follow_up";

export type ActionDashboardAiActivityKind =
  | "voice"
  | "sms"
  | "appointment"
  | "routing"
  | "handoff";

export type ActionDashboardSubaccount = {
  clientAccountId: string;
  locationId: string;
  locationName: string;
  agentDisplayName: string | null;
  connectionStatus: ActionDashboardConnectionStatus;
  lastSyncAt: string | null;
  syncMessage: string | null;
};

export type ActionDashboardSummary = {
  aiAppointmentsToday: number;
  hotActionsWaiting: number;
  callsLoggedToday: number;
  revenueSignalsToday: number;
};

export type ActionDashboardPriorityLeadWorkspace = {
  nextAction: string;
  appointmentStatus: string | null;
  policyStatus: string | null;
  ownerName: string | null;
  lastActivityAt: string;
};

export type ActionDashboardPriorityLead = {
  rank: number;
  priorityScore: number;
  contactIdGhl: string;
  leadUid: string | null;
  displayName: string;
  phoneE164: string;
  reason: string;
  reasonCode: ActionDashboardPriorityReasonCode;
  dueBy: string | null;
  estimatedPremium: number | null;
  lifecycleStage: string | null;
  lastTouchAt: string | null;
  /** When set, surfaced in the Active Lead Workspace panel */
  workspace: ActionDashboardPriorityLeadWorkspace | null;
};

export type ActionDashboardAiActivity = {
  id: string;
  at: string;
  kind: ActionDashboardAiActivityKind;
  title: string;
  detail: string | null;
  contactIdGhl: string | null;
  displayName: string | null;
};

export type ActionDashboardTodayResponse = {
  ok: true;
  generatedAt: string;
  subaccount: ActionDashboardSubaccount;
  summary: ActionDashboardSummary;
  priorityLeads: ActionDashboardPriorityLead[];
  aiActivity: ActionDashboardAiActivity[];
  setupWarnings: string[];
};
