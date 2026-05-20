import type { ClientPortalRangeKey } from "../schemas/client-dashboard.schema.js";

export const CLIENT_PORTAL_REPLY_EVENTS = [
  "contact_replied",
  "first_response",
  "ai_engaged",
  "ai_responded",
] as const;

export const CLIENT_PORTAL_SOLD_EVENTS = ["sold", "policy_issued"] as const;

export type ClientPortalActivityKind =
  | "lead"
  | "reply"
  | "appointment"
  | "show"
  | "sold"
  | "voice";

export type ActivityPresentation = {
  title: string;
  kind: ClientPortalActivityKind;
};

/** Maps internal lifecycle names to client-facing copy (never returned to clients). */
export const LIFECYCLE_TO_CLIENT_ACTIVITY: Record<string, ActivityPresentation> = {
  lead_created: { title: "Lead received", kind: "lead" },
  contact_replied: { title: "Contact replied", kind: "reply" },
  first_response: { title: "Contact replied", kind: "reply" },
  ai_engaged: { title: "AI engaged with lead", kind: "reply" },
  ai_responded: { title: "AI responded", kind: "reply" },
  appointment_set: { title: "Appointment set", kind: "appointment" },
  appointment_confirmed: { title: "Appointment confirmed", kind: "appointment" },
  appointment_showed: { title: "Appointment showed", kind: "show" },
  appointment_no_show: { title: "Appointment missed", kind: "appointment" },
  sold: { title: "Sale recorded", kind: "sold" },
  policy_issued: { title: "Policy issued", kind: "sold" },
  sale_logged: { title: "Sale recorded", kind: "sold" },
  ai_booked: { title: "AI booked appointment", kind: "voice" },
  call_connected: { title: "Call connected", kind: "voice" },
  call_attempt_logged: { title: "Call logged", kind: "voice" },
};

export function presentLifecycleActivity(eventNameInternal: string): ActivityPresentation | null {
  return LIFECYCLE_TO_CLIENT_ACTIVITY[eventNameInternal] ?? null;
}

export function computeFunnelConversion(funnel: {
  leadsReceived: number;
  replied: number;
  appointmentsSet: number;
  appointmentsShowed: number;
  sold: number;
}) {
  const { leadsReceived, replied, appointmentsSet, appointmentsShowed, sold } = funnel;
  const replyRate = leadsReceived > 0 ? replied / leadsReceived : 0;
  const setRate = leadsReceived > 0 ? appointmentsSet / leadsReceived : 0;
  const showRate = appointmentsSet > 0 ? appointmentsShowed / appointmentsSet : 0;
  const soldRate = appointmentsShowed > 0 ? sold / appointmentsShowed : 0;
  return {
    replyRate: Math.round(replyRate * 1000) / 1000,
    setRate: Math.round(setRate * 1000) / 1000,
    showRate: Math.round(showRate * 1000) / 1000,
    soldRate: Math.round(soldRate * 1000) / 1000,
  };
}

export type ClientPortalHealthStatus = "healthy" | "needs_attention" | "disconnected";

export function mapAutomationHealthToClient(
  internal: "HEALTHY" | "WARNING" | "BROKEN"
): ClientPortalHealthStatus {
  if (internal === "HEALTHY") return "healthy";
  if (internal === "WARNING") return "needs_attention";
  return "disconnected";
}

export function buildEmptyHealthHeadline(leadsReceived: number): string {
  if (leadsReceived === 0) {
    return "Waiting for first leads — your dashboard will populate as activity arrives";
  }
  return "Your lead system is active and receiving updates";
}

export function buildLeadUpdatesDetail(leadsReceived: number): string {
  if (leadsReceived === 0) return "Waiting for first leads";
  return `${leadsReceived} lead${leadsReceived === 1 ? "" : "s"} received in this period`;
}

export function buildAppointmentsDetail(appointmentsSet: number): string {
  if (appointmentsSet === 0) return "No appointments in this range yet";
  return `${appointmentsSet} appointment${appointmentsSet === 1 ? "" : "s"} set in this period`;
}

export const NO_SHOW_STATUSES = ["No Show", "no_show", "NO_SHOW", "No-Show"];
export const NEEDS_CONFIRM_STATUSES = [
  "Scheduled",
  "scheduled",
  "SCHEDULED",
  "Booked",
  "booked",
  "Confirmed",
  "confirmed",
];
