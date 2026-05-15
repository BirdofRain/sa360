import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import type { AutomationDashboardFilters } from "../schemas/automation-dashboard.schema.js";

export const HUMAN_ACTIVATION_STAGES = [
  "ATTEMPTING_CONTACT",
  "attempting_contact",
  "NEW",
  "new",
  "FOLLOW_UP",
  "follow_up",
  "Attempting Contact",
  "Needs Agent",
  "needs_agent",
];

export const REMINDER_APPOINTMENT_STATUSES = [
  "Reminder Sent",
  "reminder_sent",
  "REMINDER_SENT",
];

export const NO_SHOW_APPOINTMENT_STATUSES = ["No Show", "no_show", "NO_SHOW", "No-Show"];

export type LifecyclePayloadSlice = {
  contact?: {
    lead_uid?: string;
    contact_id_ghl?: string;
    first_name?: string;
    last_name?: string;
    phone_e164?: string;
    phone?: string;
  };
  state?: {
    lifecycle_stage?: string;
    appointment_status?: string;
    ai_status?: string;
    agent_disposition?: string;
    routing_status?: string;
  };
  ownership?: {
    assigned_agent_name?: string;
  };
  event?: {
    event_time_unix?: number;
  };
};

export function parseLifecyclePayload(payloadJson: unknown): LifecyclePayloadSlice {
  if (!payloadJson || typeof payloadJson !== "object") return {};
  return payloadJson as LifecyclePayloadSlice;
}

export function contactDisplayName(p: LifecyclePayloadSlice): string | null {
  const c = p.contact;
  if (!c) return null;
  const joined = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return joined || null;
}

export function lifecycleWhere(f: AutomationDashboardFilters): PrismaTypes.LifecycleEventWhereInput {
  const w: PrismaTypes.LifecycleEventWhereInput = {
    receivedAt: { gte: f.from, lte: f.to },
  };
  if (f.clientAccountId) w.clientAccountId = f.clientAccountId;
  if (f.subaccountIdGhl) w.subaccountIdGhl = f.subaccountIdGhl;
  return w;
}

export function webhookWhere(f: AutomationDashboardFilters): PrismaTypes.WebhookRequestLogWhereInput {
  const w: PrismaTypes.WebhookRequestLogWhereInput = {
    source: "ghl_lifecycle",
    receivedAt: { gte: f.from, lte: f.to },
  };
  if (f.clientAccountId) w.clientAccountId = f.clientAccountId;
  if (f.subaccountIdGhl) w.subaccountIdGhl = f.subaccountIdGhl;
  return w;
}

export function indexWhere(f: AutomationDashboardFilters): PrismaTypes.InboundContactIndexWhereInput {
  const w: PrismaTypes.InboundContactIndexWhereInput = {};
  if (f.clientAccountId) w.clientAccountId = f.clientAccountId;
  if (f.subaccountIdGhl) w.subaccountIdGhl = f.subaccountIdGhl;
  if (f.nicheKey) w.leadType = { equals: f.nicheKey, mode: "insensitive" };
  return w;
}

export function humanActivationIndexWhere(
  f: AutomationDashboardFilters
): PrismaTypes.InboundContactIndexWhereInput {
  return {
    ...indexWhere(f),
    OR: HUMAN_ACTIVATION_STAGES.map((s) => ({
      lifecycleStage: { equals: s, mode: "insensitive" as const },
    })),
  };
}

/** Lifecycle rows that power remindersSent KPI and appointment_reminder_sent funnel step. */
export function remindersSentWhere(
  f: AutomationDashboardFilters
): PrismaTypes.LifecycleEventWhereInput {
  return {
    ...lifecycleWhere(f),
    OR: [
      { eventNameInternal: "appointment_reminder_sent" },
      {
        eventNameInternal: "contact_updated",
        OR: REMINDER_APPOINTMENT_STATUSES.map((status) => ({
          payloadJson: {
            path: ["state", "appointment_status"],
            equals: status,
          },
        })),
      },
    ],
  };
}

export function contactUpdatedStatusWhere(
  f: AutomationDashboardFilters,
  statuses: string[]
): PrismaTypes.LifecycleEventWhereInput {
  return {
    ...lifecycleWhere(f),
    eventNameInternal: "contact_updated",
    OR: statuses.map((status) => ({
      payloadJson: {
        path: ["state", "appointment_status"],
        equals: status,
      },
    })),
  };
}

export function contactUpdatedDispositionWhere(
  f: AutomationDashboardFilters
): PrismaTypes.LifecycleEventWhereInput {
  return {
    ...lifecycleWhere(f),
    eventNameInternal: "contact_updated",
    payloadJson: {
      path: ["state", "agent_disposition"],
      not: Prisma.DbNull,
    },
  };
}

export type AppointmentSource = "BOT" | "AI" | "AGENT" | "UNKNOWN";
export type ActivationStatus = "NOT_NEEDED" | "NEEDED" | "COMPLETED" | "UNKNOWN";

export function inferAppointmentSource(
  eventNameInternal: string,
  payload: LifecyclePayloadSlice,
  fromSynthflow: boolean
): AppointmentSource {
  if (fromSynthflow) return "AI";
  const ai = payload.state?.ai_status?.toLowerCase() ?? "";
  if (ai.includes("bot") || ai.includes("synthflow") || ai.includes("ai")) {
    return ai.includes("bot") ? "BOT" : "AI";
  }
  if (eventNameInternal === "appointment_set" && payload.ownership?.assigned_agent_name) {
    return "AGENT";
  }
  return "UNKNOWN";
}

export function inferActivationStatus(
  eventNameInternal: string,
  payload: LifecyclePayloadSlice,
  indexStage?: string | null
): ActivationStatus {
  if (eventNameInternal === "appointment_showed" || eventNameInternal === "sale_logged") {
    return "COMPLETED";
  }
  const stage = (payload.state?.lifecycle_stage ?? indexStage ?? "").toLowerCase();
  if (
    HUMAN_ACTIVATION_STAGES.some((s) => stage === s.toLowerCase()) ||
    stage.includes("attempting") ||
    stage.includes("follow")
  ) {
    return "NEEDED";
  }
  if (eventNameInternal === "appointment_set") return "NOT_NEEDED";
  return "UNKNOWN";
}

export const WORKFLOW_CHECKPOINT_DEFS = [
  { eventName: "lead_created", label: "Lead Created" },
  { eventName: "first_response", label: "First Response" },
  { eventName: "ai_engaged", label: "AI Engaged" },
  { eventName: "appointment_set", label: "Appointment Set" },
  { eventName: "appointment_reminder_sent", label: "Reminder Sent" },
  { eventName: "human_activation_needed", label: "Human Activation" },
  { eventName: "appointment_showed", label: "Appointment Showed" },
  { eventName: "no_show", label: "No Show" },
  { eventName: "outcome_logged", label: "Outcome Logged" },
  { eventName: "signal_sent", label: "Signal Sent" },
] as const;
