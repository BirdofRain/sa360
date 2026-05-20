/**
 * Client Portal — UI contract (mock Phase 1; aligns with future GET /client/v1/dashboard).
 */

export type ClientPortalRangeKey = "7d" | "30d" | "mtd";

export type ClientPortalHealthStatus = "healthy" | "needs_attention" | "disconnected";

export type ClientPortalHealthCheck = {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
};

export type ClientPortalSystemHealth = {
  status: ClientPortalHealthStatus;
  headline: string;
  lastActivityAt: string;
  checks: ClientPortalHealthCheck[];
};

export type ClientPortalFunnel = {
  leadsReceived: number;
  replied: number;
  appointmentsSet: number;
  appointmentsShowed: number;
  sold: number;
  conversion: {
    replyRate: number;
    setRate: number;
    showRate: number;
    soldRate: number;
  };
};

export type ClientPortalActivityKind =
  | "lead"
  | "reply"
  | "appointment"
  | "show"
  | "sold"
  | "voice";

export type ClientPortalRecentActivity = {
  id: string;
  at: string;
  kind: ClientPortalActivityKind;
  title: string;
  subtitle?: string | null;
};

export type ClientPortalAppointmentAttention = {
  contactIdGhl: string;
  displayName: string;
  reason: string;
  reasonCode: "upcoming" | "no_show" | "needs_confirmation" | "follow_up";
  appointmentStatus?: string | null;
  lastActivityAt: string;
};

export type ClientPortalLeadSource = {
  label: string;
  sourcePlatform?: string | null;
  leadCount: number;
  appointmentsSet: number;
};

export type ClientPortalAiVoice = {
  enabled: boolean;
  inboundCalls: number;
  aiAppointmentsBooked: number;
  lastVoiceActivityAt: string | null;
};

export type ClientPortalDashboard = {
  ok: true;
  generatedAt: string;
  range: { from: string; to: string; key: ClientPortalRangeKey; label: string };
  client: {
    displayName: string;
    locationLabel?: string | null;
  };
  systemHealth: ClientPortalSystemHealth;
  funnel: ClientPortalFunnel;
  recentActivity: ClientPortalRecentActivity[];
  appointmentsNeedingAttention: ClientPortalAppointmentAttention[];
  leadSources: ClientPortalLeadSource[];
  aiVoice: ClientPortalAiVoice;
};
