/**
 * Daily Action Center — UI shapes mapped from `GET /admin/v1/action-dashboard/today`.
 * Mock data in `mock-data.ts` is for tests only.
 */

import type { CollectionAvailability, SectionAvailability } from "./defensive-payload";

export type GhlConnectionStatusCode = "connected" | "degraded" | "disconnected" | "unknown";

export type GhlConnectionStatus = {
  status: GhlConnectionStatusCode;
  /** Original API status when it is not a known connection code. */
  rawStatus?: string;
  locationId: string;
  locationName: string;
  /** ISO timestamp of last successful sync, or null if unknown */
  lastSyncAt: string | null;
  message?: string;
};

export type ActionCenterKpis = {
  aiAppointmentsToday: number | null;
  hotActionsWaiting: number | null;
  callsLoggedToday: number | null;
  revenueSignalsToday: number | null;
};

export type PriorityCallReasonCode =
  | "ai_appointment_ready"
  | "hot_lead"
  | "callback_due"
  | "revenue_signal"
  | "stale_follow_up";

export type PriorityCallItem = {
  rank: number;
  priorityScore: number;
  contactIdGhl: string;
  leadUid?: string | null;
  displayName: string;
  phoneE164: string;
  reason: string;
  reasonCode: PriorityCallReasonCode | string;
  /** ISO — when this action should be completed */
  dueBy?: string | null;
  estimatedPremium?: number | null;
  lifecycleStage?: string | null;
  lastTouchAt?: string | null;
  /** From API workspace — enables calendar deep link when set */
  appointmentStatus?: string | null;
};

export type ActiveLeadWorkspaceItem = {
  contactIdGhl: string;
  leadUid?: string | null;
  phoneE164?: string | null;
  displayName: string;
  lifecycleStage: string;
  appointmentStatus?: string | null;
  policyStatus?: string | null;
  nextAction: string;
  /** ISO */
  lastActivityAt: string;
  ownerName?: string | null;
};

export type AiActivityFeedKind = "voice" | "sms" | "appointment" | "routing" | "handoff";

export type AiActivityFeedItem = {
  id: string;
  /** ISO */
  at: string;
  kind: AiActivityFeedKind | string;
  title: string;
  detail?: string | null;
  contactIdGhl?: string | null;
  displayName?: string | null;
};

export type ActionCenterSectionAvailability = {
  ghlConnection: SectionAvailability;
  kpis: SectionAvailability;
  priorityCalls: CollectionAvailability;
  activeLeads: CollectionAvailability;
  aiActivity: CollectionAvailability;
  setupWarnings: CollectionAvailability;
};

/** Future API success payload */
export type ActionCenterDashboardResponse = {
  ok: true;
  generatedAt: string;
  clientAccountId: string;
  locationId?: string | null;
  agentDisplayName?: string | null;
  ghlConnection: GhlConnectionStatus;
  kpis: ActionCenterKpis;
  priorityCalls: PriorityCallItem[];
  activeLeads: ActiveLeadWorkspaceItem[];
  aiActivityFeed: AiActivityFeedItem[];
};

export type ActionCenterMappedDashboard = ActionCenterDashboardResponse & {
  setupWarnings: string[];
  sections: ActionCenterSectionAvailability;
};
