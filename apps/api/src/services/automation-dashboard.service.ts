import { prisma } from "../lib/db.js";
import type { AutomationDashboardFilters } from "../schemas/automation-dashboard.schema.js";
import {
  HUMAN_ACTIVATION_STAGES,
  WORKFLOW_CHECKPOINT_DEFS,
  contactDisplayName,
  contactUpdatedDispositionWhere,
  contactUpdatedStatusWhere,
  remindersSentWhere,
  humanActivationIndexWhere,
  indexWhere,
  inferActivationStatus,
  inferAppointmentSource,
  lifecycleWhere,
  parseLifecyclePayload,
  webhookWhere,
  type ActivationStatus,
  type AppointmentSource,
} from "./automation-dashboard.helpers.js";

export type AutomationHealthStatus = "HEALTHY" | "WARNING" | "BROKEN";

export type AutomationDashboardSummary = {
  ok: true;
  range: { from: string; to: string };
  filters: {
    clientAccountId?: string;
    locationId?: string;
    nicheKey?: string;
  };
  leadsReceived: number;
  firstResponses: number;
  aiEngaged: number;
  appointmentsSet: number;
  remindersSent: number;
  humanActivationNeeded: number;
  appointmentShowed: number;
  noShows: number;
  outcomeLogged: number;
  signalSent: number;
  signalFailed: number;
  webhookFailures: number;
  lastWebhookAt: string | null;
  healthStatus: AutomationHealthStatus;
  dataLimitations: string[];
};

export type WorkflowCheckpointRow = {
  eventName: string;
  label: string;
  count: number;
  percentageOfLeads: number | null;
  failedCount: number | null;
  lastEventAt: string | null;
};

export type AutomationAppointmentRow = {
  eventId: string;
  clientAccountId: string;
  locationId: string;
  contactIdGhl: string | null;
  leadUid: string | null;
  contactName: string | null;
  phone: string | null;
  assignedAgentName: string | null;
  appointmentTime: string | null;
  appointmentStatus: string | null;
  source: AppointmentSource;
  activationStatus: ActivationStatus;
  lastEventAt: string;
};

export type AutomationAppointmentsResponse = {
  ok: true;
  range: { from: string; to: string };
  rows: AutomationAppointmentRow[];
  dataLimitations: string[];
};

export type AutomationSignalHealthResponse = {
  ok: true;
  range: { from: string; to: string };
  eventsByInternalName: Array<{ eventNameInternal: string; count: number }>;
  webhookByProcessingStatus: Array<{ processingStatus: string; count: number }>;
  validationFailures: number;
  duplicatesOrSkipped: number;
  webhookFailures: number;
  failedWebhookLogs: Array<{
    id: string;
    receivedAt: string;
    processingStatus: string;
    eventNameInternal: string | null;
    clientAccountId: string | null;
    errorSummary: string | null;
  }>;
  signalSent: number;
  signalFailed: number;
  lastSuccessfulSignalAt: string | null;
  lastFailedSignalAt: string | null;
  dataLimitations: string[];
};

export type AutomationAccountRow = {
  clientAccountId: string;
  locationId: string;
  leadsToday: number;
  appointmentsToday: number;
  activeLeadPool: number | null;
  lastWebhookAt: string | null;
  failureCount24h: number;
  healthStatus: AutomationHealthStatus;
  warnings: string[];
};

export type AutomationAccountsResponse = {
  ok: true;
  accounts: AutomationAccountRow[];
  dataLimitations: string[];
};

function utcStartOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function synthflowWhere(f: AutomationDashboardFilters) {
  return {
    receivedAt: { gte: f.from, lte: f.to },
    ...(f.clientAccountId ? { clientAccountId: f.clientAccountId } : {}),
    ...(f.subaccountIdGhl ? { subaccountIdGhl: f.subaccountIdGhl } : {}),
  };
}

function outboundWhere(f: AutomationDashboardFilters) {
  return {
    receivedAt: { gte: f.from, lte: f.to },
    ...(f.clientAccountId ? { clientAccountId: f.clientAccountId } : {}),
    ...(f.subaccountIdGhl ? { subaccountIdGhl: f.subaccountIdGhl } : {}),
  };
}

export function computeHealthStatus(input: {
  webhookFailures: number;
  webhookTotal: number;
  signalFailures: number;
  signalAttempts: number;
  validationFailures: number;
}): AutomationHealthStatus {
  const whRate = input.webhookTotal > 0 ? input.webhookFailures / input.webhookTotal : 0;
  const sigRate =
    input.signalAttempts > 0 ? input.signalFailures / input.signalAttempts : 0;

  if (whRate >= 0.2 || input.validationFailures >= 10 || sigRate >= 0.5) {
    return "BROKEN";
  }
  if (whRate >= 0.05 || input.validationFailures >= 3 || sigRate >= 0.2) {
    return "WARNING";
  }
  return "HEALTHY";
}

async function countLifecycle(f: AutomationDashboardFilters, eventNameInternal: string) {
  return prisma.lifecycleEvent.count({
    where: { ...lifecycleWhere(f), eventNameInternal },
  });
}

async function countWebhookFailuresForEvent(f: AutomationDashboardFilters, eventNameInternal: string) {
  return prisma.webhookRequestLog.count({
    where: {
      ...webhookWhere(f),
      eventNameInternal,
      OR: [
        { processingStatus: { in: ["failed", "validation_failed", "unauthorized"] } },
        { httpStatus: { gte: 500 } },
      ],
    },
  });
}

async function lastLifecycleAt(f: AutomationDashboardFilters, eventNameInternal: string) {
  const row = await prisma.lifecycleEvent.findFirst({
    where: { ...lifecycleWhere(f), eventNameInternal },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  return row?.receivedAt ?? null;
}

async function distinctLeadDenominator(f: AutomationDashboardFilters) {
  const rows = await prisma.lifecycleEvent.findMany({
    where: { ...lifecycleWhere(f), eventNameInternal: "lead_created" },
    select: { leadUid: true },
    distinct: ["leadUid"],
  });
  return rows.length;
}

async function countRemindersSent(f: AutomationDashboardFilters) {
  return prisma.lifecycleEvent.count({ where: remindersSentWhere(f) });
}

async function countNoShows(f: AutomationDashboardFilters) {
  return prisma.lifecycleEvent.count({
    where: contactUpdatedStatusWhere(f, ["No Show", "no_show", "NO_SHOW", "No-Show"]),
  });
}

async function countOutcomeLogged(f: AutomationDashboardFilters) {
  const [dispositions, sales, workspace] = await Promise.all([
    prisma.lifecycleEvent.count({ where: contactUpdatedDispositionWhere(f) }),
    countLifecycle(f, "sale_logged"),
    prisma.agentWorkspaceAction.count({
      where: {
        actionType: "what_happened",
        createdAt: { gte: f.from, lte: f.to },
        ...(f.clientAccountId ? { clientAccountId: f.clientAccountId } : {}),
        ...(f.subaccountIdGhl ? { subaccountIdGhl: f.subaccountIdGhl } : {}),
      },
    }),
  ]);
  return dispositions + sales + workspace;
}

const SUMMARY_LIMITATIONS = [
  "Legacy stacks may still send contact_updated + appointment_status REMINDER_SENT; both patterns count toward remindersSent.",
  "humanActivationNeeded uses InboundContactIndex lifecycle stages; GHL human_activation_needed webhooks improve accuracy when added.",
  "aiEngaged uses SynthflowRequestLog volume, not per-lead dedupe.",
];

export async function getAutomationDashboardSummary(
  f: AutomationDashboardFilters
): Promise<AutomationDashboardSummary> {
  const baseWebhook = webhookWhere(f);

  const [
    leadsReceived,
    firstResponses,
    aiEngaged,
    appointmentsSet,
    remindersSent,
    humanActivationNeeded,
    appointmentShowed,
    noShows,
    outcomeLogged,
    signalSent,
    signalFailed,
    webhookFailures,
    webhookTotal,
    webhookValidationFailures,
    lastWebhook,
  ] = await Promise.all([
    countLifecycle(f, "lead_created"),
    countLifecycle(f, "first_response"),
    prisma.synthflowRequestLog.count({ where: synthflowWhere(f) }),
    countLifecycle(f, "appointment_set"),
    countRemindersSent(f),
    prisma.inboundContactIndex.count({ where: humanActivationIndexWhere(f) }),
    countLifecycle(f, "appointment_showed"),
    countNoShows(f),
    countOutcomeLogged(f),
    prisma.metaDispatchAttempt.count({
      where: { success: true, attemptedAt: { gte: f.from, lte: f.to } },
    }),
    prisma.metaDispatchAttempt.count({
      where: { success: false, attemptedAt: { gte: f.from, lte: f.to } },
    }),
    prisma.webhookRequestLog.count({
      where: {
        ...baseWebhook,
        OR: [{ processingStatus: "failed" }, { httpStatus: { gte: 500 } }],
      },
    }),
    prisma.webhookRequestLog.count({ where: baseWebhook }),
    prisma.webhookRequestLog.count({
      where: { ...baseWebhook, processingStatus: "validation_failed" },
    }),
    prisma.webhookRequestLog.findFirst({
      where: baseWebhook,
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
  ]);

  const signalAttempts = signalSent + signalFailed;

  return {
    ok: true,
    range: { from: f.from.toISOString(), to: f.to.toISOString() },
    filters: {
      clientAccountId: f.clientAccountId,
      locationId: f.subaccountIdGhl,
      nicheKey: f.nicheKey,
    },
    leadsReceived,
    firstResponses,
    aiEngaged,
    appointmentsSet,
    remindersSent,
    humanActivationNeeded,
    appointmentShowed,
    noShows,
    outcomeLogged,
    signalSent,
    signalFailed,
    webhookFailures,
    lastWebhookAt: lastWebhook?.receivedAt?.toISOString() ?? null,
    healthStatus: computeHealthStatus({
      webhookFailures,
      webhookTotal,
      signalFailures: signalFailed,
      signalAttempts,
      validationFailures: webhookValidationFailures,
    }),
    dataLimitations: SUMMARY_LIMITATIONS,
  };
}

const FUNNEL_LIMITATIONS = [
  "Prefer event_name_internal appointment_reminder_sent from GHL; contact_updated + REMINDER_SENT remains supported for legacy workflows.",
  "no_show is inferred from contact_updated + appointment_status values, not a dedicated internal event yet.",
  "ai_engaged uses Synthflow request logs; GHL mirror events are optional.",
  "signal_sent uses MetaDispatchAttempt success count, not GHL webhooks.",
];

export async function getAutomationWorkflowProgression(f: AutomationDashboardFilters): Promise<{
  ok: true;
  range: { from: string; to: string };
  checkpoints: WorkflowCheckpointRow[];
  dataLimitations: string[];
}> {
  const denominator = await distinctLeadDenominator(f);

  const countFns: Record<string, () => Promise<number>> = {
    lead_created: () => countLifecycle(f, "lead_created"),
    first_response: () => countLifecycle(f, "first_response"),
    ai_engaged: () => prisma.synthflowRequestLog.count({ where: synthflowWhere(f) }),
    appointment_set: () => countLifecycle(f, "appointment_set"),
    appointment_reminder_sent: () => countRemindersSent(f),
    human_activation_needed: () =>
      prisma.inboundContactIndex.count({ where: humanActivationIndexWhere(f) }),
    appointment_showed: () => countLifecycle(f, "appointment_showed"),
    no_show: () => countNoShows(f),
    outcome_logged: () => countOutcomeLogged(f),
    signal_sent: () =>
      prisma.metaDispatchAttempt.count({
        where: { success: true, attemptedAt: { gte: f.from, lte: f.to } },
      }),
  };

  const failedFns: Record<string, () => Promise<number | null>> = {
    lead_created: () => countWebhookFailuresForEvent(f, "lead_created"),
    first_response: () => countWebhookFailuresForEvent(f, "first_response"),
    appointment_set: () => countWebhookFailuresForEvent(f, "appointment_set"),
    appointment_showed: () => countWebhookFailuresForEvent(f, "appointment_showed"),
    outcome_logged: () => countWebhookFailuresForEvent(f, "sale_logged"),
    ai_engaged: async () =>
      prisma.synthflowRequestLog.count({
        where: {
          ...synthflowWhere(f),
          OR: [{ processingStatus: "lookup_error" }, { lookupStatus: "lookup_error" }],
        },
      }),
    signal_sent: () =>
      prisma.metaDispatchAttempt.count({
        where: { success: false, attemptedAt: { gte: f.from, lte: f.to } },
      }),
  };

  const lastFns: Record<string, () => Promise<Date | null>> = {
    lead_created: () => lastLifecycleAt(f, "lead_created"),
    first_response: () => lastLifecycleAt(f, "first_response"),
    appointment_set: () => lastLifecycleAt(f, "appointment_set"),
    appointment_reminder_sent: async () => {
      const row = await prisma.lifecycleEvent.findFirst({
        where: remindersSentWhere(f),
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      });
      return row?.receivedAt ?? null;
    },
    human_activation_needed: async () => {
      const row = await prisma.inboundContactIndex.findFirst({
        where: humanActivationIndexWhere(f),
        orderBy: { lastSeenAt: "desc" },
        select: { lastSeenAt: true },
      });
      return row?.lastSeenAt ?? null;
    },
    appointment_showed: () => lastLifecycleAt(f, "appointment_showed"),
    no_show: async () => {
      const row = await prisma.lifecycleEvent.findFirst({
        where: contactUpdatedStatusWhere(f, ["No Show", "no_show", "NO_SHOW", "No-Show"]),
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      });
      return row?.receivedAt ?? null;
    },
    outcome_logged: () => lastLifecycleAt(f, "sale_logged"),
    ai_engaged: async () => {
      const row = await prisma.synthflowRequestLog.findFirst({
        where: synthflowWhere(f),
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true },
      });
      return row?.receivedAt ?? null;
    },
    signal_sent: async () => {
      const row = await prisma.metaDispatchAttempt.findFirst({
        where: { success: true, attemptedAt: { gte: f.from, lte: f.to } },
        orderBy: { attemptedAt: "desc" },
        select: { attemptedAt: true },
      });
      return row?.attemptedAt ?? null;
    },
  };

  const checkpoints: WorkflowCheckpointRow[] = [];
  for (const def of WORKFLOW_CHECKPOINT_DEFS) {
    const count = await (countFns[def.eventName] ?? (async () => 0))();
    const failedCount = failedFns[def.eventName] ? await failedFns[def.eventName]() : null;
    const lastAt = lastFns[def.eventName] ? await lastFns[def.eventName]() : null;
    checkpoints.push({
      eventName: def.eventName,
      label: def.label,
      count,
      percentageOfLeads:
        denominator > 0 ? Math.round((count / denominator) * 1000) / 10 : null,
      failedCount,
      lastEventAt: lastAt?.toISOString() ?? null,
    });
  }

  return {
    ok: true,
    range: { from: f.from.toISOString(), to: f.to.toISOString() },
    checkpoints,
    dataLimitations: FUNNEL_LIMITATIONS,
  };
}

function lifecycleRowToAppointment(
  ev: {
    id: string;
    clientAccountId: string;
    subaccountIdGhl: string | null;
    leadUid: string;
    contactIdGhl: string | null;
    eventNameInternal: string;
    receivedAt: Date;
    payloadJson: unknown;
  },
  appointmentTime: string | null,
  appointmentStatus: string | null
): AutomationAppointmentRow {
  const payload = parseLifecyclePayload(ev.payloadJson);
  return {
    eventId: ev.id,
    clientAccountId: ev.clientAccountId,
    locationId: ev.subaccountIdGhl ?? "",
    contactIdGhl: ev.contactIdGhl ?? payload.contact?.contact_id_ghl ?? null,
    leadUid: ev.leadUid ?? payload.contact?.lead_uid ?? null,
    contactName: contactDisplayName(payload),
    phone: payload.contact?.phone_e164 ?? payload.contact?.phone ?? null,
    assignedAgentName: payload.ownership?.assigned_agent_name ?? null,
    appointmentTime,
    appointmentStatus,
    source: inferAppointmentSource(ev.eventNameInternal, payload, false),
    activationStatus: inferActivationStatus(ev.eventNameInternal, payload),
    lastEventAt: ev.receivedAt.toISOString(),
  };
}

const APPOINTMENTS_LIMITATIONS = [
  "appointmentTime is null for most GHL lifecycle rows until appointment time is posted in payload or Synthflow outbound supplies appointmentTime.",
  "Rows are capped at 200 lifecycle + 100 Synthflow outbound events per request.",
];

export async function getAutomationAppointments(
  f: AutomationDashboardFilters
): Promise<AutomationAppointmentsResponse> {
  const eventNames = [
    "appointment_set",
    "appointment_reminder_sent",
    "appointment_showed",
    "first_response",
    "sale_logged",
  ];

  const lifecycleRowsFixed = await prisma.lifecycleEvent.findMany({
    where: {
      ...lifecycleWhere(f),
      OR: [
        { eventNameInternal: { in: eventNames } },
        remindersSentWhere(f),
        {
          eventNameInternal: "contact_updated",
          OR: [
            ...["No Show", "no_show"].map((status) => ({
              payloadJson: { path: ["state", "appointment_status"], equals: status },
            })),
            ...HUMAN_ACTIVATION_STAGES.slice(0, 3).map((stage) => ({
              payloadJson: { path: ["state", "lifecycle_stage"], equals: stage },
            })),
          ],
        },
      ],
    },
    take: 200,
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      clientAccountId: true,
      subaccountIdGhl: true,
      leadUid: true,
      contactIdGhl: true,
      eventNameInternal: true,
      receivedAt: true,
      payloadJson: true,
    },
  });

  const rows: AutomationAppointmentRow[] = [];

  for (const ev of lifecycleRowsFixed) {
    const payload = parseLifecyclePayload(ev.payloadJson);
    const status =
      payload.state?.appointment_status ??
      (ev.eventNameInternal === "appointment_showed" ? "Showed" : null);
    rows.push(
      lifecycleRowToAppointment(ev, null, status)
    );
  }

  const outboundRows = await prisma.synthflowOutboundResultLog.findMany({
    where: {
      ...outboundWhere(f),
      OR: [{ booked: true }, { appointmentTime: { not: null } }],
    },
    take: 100,
    orderBy: [{ appointmentTime: "asc" }, { receivedAt: "desc" }],
  });

  for (const o of outboundRows) {
    rows.push({
      eventId: o.id,
      clientAccountId: o.clientAccountId ?? "",
      locationId: o.subaccountIdGhl ?? "",
      contactIdGhl: o.contactIdGhl,
      leadUid: null,
      contactName: null,
      phone: o.toNumberE164 ?? o.toNumber,
      assignedAgentName: null,
      appointmentTime: o.appointmentTime?.toISOString() ?? null,
      appointmentStatus: o.outcome,
      source: "AI",
      activationStatus: o.booked ? "NOT_NEEDED" : "NEEDED",
      lastEventAt: o.receivedAt.toISOString(),
    });
  }

  const indexHuman = await prisma.inboundContactIndex.findMany({
    where: {
      ...humanActivationIndexWhere(f),
      OR: [
        { appointmentStatus: { not: null } },
        { lifecycleStage: { contains: "appointment", mode: "insensitive" } },
      ],
    },
    take: 50,
    orderBy: { lastSeenAt: "desc" },
  });

  for (const idx of indexHuman) {
    rows.push({
      eventId: `index:${idx.id}`,
      clientAccountId: idx.clientAccountId,
      locationId: idx.subaccountIdGhl,
      contactIdGhl: idx.contactIdGhl,
      leadUid: idx.leadUid,
      contactName:
        idx.displayName ??
        ([idx.firstName, idx.lastName].filter(Boolean).join(" ") || null),
      phone: idx.phoneE164,
      assignedAgentName: idx.assignedAgentName,
      appointmentTime: null,
      appointmentStatus: idx.appointmentStatus,
      source: "UNKNOWN",
      activationStatus: inferActivationStatus("contact_updated", {}, idx.lifecycleStage),
      lastEventAt: idx.lastSeenAt.toISOString(),
    });
  }

  rows.sort((a, b) => {
    const ta = a.appointmentTime ? new Date(a.appointmentTime).getTime() : 0;
    const tb = b.appointmentTime ? new Date(b.appointmentTime).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return new Date(b.lastEventAt).getTime() - new Date(a.lastEventAt).getTime();
  });

  return {
    ok: true,
    range: { from: f.from.toISOString(), to: f.to.toISOString() },
    rows: rows.slice(0, 150),
    dataLimitations: APPOINTMENTS_LIMITATIONS,
  };
}

const SIGNAL_LIMITATIONS = [
  "eventsByInternalName is from WebhookRequestLog, not LifecycleEvent counts.",
  "Meta dispatch rows are not filtered by clientAccountId until eventUuid join is added.",
];

export async function getAutomationSignalHealth(
  f: AutomationDashboardFilters
): Promise<AutomationSignalHealthResponse> {
  const baseWebhook = webhookWhere(f);

  const [
    lifecycleByType,
    webhookByStatus,
    validationFailures,
    duplicatesOrSkipped,
    webhookFailures,
    failedWebhookLogs,
    signalSent,
    signalFailed,
    lastSuccess,
    lastFailed,
  ] = await Promise.all([
    prisma.lifecycleEvent.groupBy({
      by: ["eventNameInternal"],
      where: lifecycleWhere(f),
      _count: { _all: true },
    }),
    prisma.webhookRequestLog.groupBy({
      by: ["processingStatus"],
      where: baseWebhook,
      _count: { _all: true },
    }),
    prisma.webhookRequestLog.count({
      where: { ...baseWebhook, processingStatus: "validation_failed" },
    }),
    prisma.webhookRequestLog.count({
      where: {
        ...baseWebhook,
        processingStatus: { in: ["skipped", "duplicate_index_refreshed"] },
      },
    }),
    prisma.webhookRequestLog.count({
      where: {
        ...baseWebhook,
        OR: [{ processingStatus: "failed" }, { httpStatus: { gte: 500 } }],
      },
    }),
    prisma.webhookRequestLog.findMany({
      where: {
        ...baseWebhook,
        OR: [
          { processingStatus: { in: ["failed", "validation_failed", "unauthorized"] } },
          { httpStatus: { gte: 400 } },
        ],
      },
      orderBy: { receivedAt: "desc" },
      take: 25,
      select: {
        id: true,
        receivedAt: true,
        processingStatus: true,
        eventNameInternal: true,
        clientAccountId: true,
        errorSummary: true,
      },
    }),
    prisma.metaDispatchAttempt.count({
      where: { success: true, attemptedAt: { gte: f.from, lte: f.to } },
    }),
    prisma.metaDispatchAttempt.count({
      where: { success: false, attemptedAt: { gte: f.from, lte: f.to } },
    }),
    prisma.metaDispatchAttempt.findFirst({
      where: { success: true, attemptedAt: { gte: f.from, lte: f.to } },
      orderBy: { attemptedAt: "desc" },
      select: { attemptedAt: true },
    }),
    prisma.metaDispatchAttempt.findFirst({
      where: { success: false, attemptedAt: { gte: f.from, lte: f.to } },
      orderBy: { attemptedAt: "desc" },
      select: { attemptedAt: true },
    }),
  ]);

  return {
    ok: true,
    range: { from: f.from.toISOString(), to: f.to.toISOString() },
    eventsByInternalName: lifecycleByType
      .map((g) => ({ eventNameInternal: g.eventNameInternal, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    webhookByProcessingStatus: webhookByStatus
      .map((g) => ({ processingStatus: g.processingStatus, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    validationFailures,
    duplicatesOrSkipped,
    webhookFailures,
    failedWebhookLogs: failedWebhookLogs.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt.toISOString(),
      processingStatus: r.processingStatus,
      eventNameInternal: r.eventNameInternal,
      clientAccountId: r.clientAccountId,
      errorSummary: r.errorSummary,
    })),
    signalSent,
    signalFailed,
    lastSuccessfulSignalAt: lastSuccess?.attemptedAt?.toISOString() ?? null,
    lastFailedSignalAt: lastFailed?.attemptedAt?.toISOString() ?? null,
    dataLimitations: SIGNAL_LIMITATIONS,
  };
}

function accountWarnings(input: {
  failureCount24h: number;
  lastWebhookAt: string | null;
  leadsToday: number;
  remindersSent: number;
}): string[] {
  const w: string[] = [];
  if (input.failureCount24h > 0) {
    w.push(`${input.failureCount24h} webhook failure(s) in the last 24h`);
  }
  if (!input.lastWebhookAt) {
    w.push("No webhook activity in selected range");
  } else {
    const ageH = (Date.now() - new Date(input.lastWebhookAt).getTime()) / 3_600_000;
    if (ageH > 24) w.push(`Last webhook ${Math.round(ageH)}h ago`);
  }
  if (input.leadsToday > 0 && input.remindersSent === 0) {
    w.push("Leads today but no reminder events detected — add SA360 appointment_reminder_sent workflow");
  }
  return w;
}

const ACCOUNTS_LIMITATIONS = [
  "Account list is derived from WebhookRequestLog groups; accounts with only Synthflow traffic may be missing.",
  "activeLeadPool is InboundContactIndex count for the location (not deduped leads in range).",
];

export async function getAutomationAccounts(
  f: AutomationDashboardFilters
): Promise<AutomationAccountsResponse> {
  const todayStart = utcStartOfDay(new Date());
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const webhookGroups = await prisma.webhookRequestLog.groupBy({
    by: ["clientAccountId", "subaccountIdGhl"],
    where: {
      ...webhookWhere(f),
      clientAccountId: { not: null },
    },
    _max: { receivedAt: true },
  });

  const accounts: AutomationAccountRow[] = [];

  for (const g of webhookGroups) {
    const clientAccountId = g.clientAccountId as string;
    const locationId = g.subaccountIdGhl ?? "";
    const accountFilter: AutomationDashboardFilters = {
      ...f,
      clientAccountId,
      subaccountIdGhl: locationId || undefined,
    };

    const [
      leadsToday,
      appointmentsToday,
      activeLeadPool,
      failureCount24h,
      webhookTotal,
      webhookFailures,
      remindersSent,
    ] = await Promise.all([
      prisma.lifecycleEvent.count({
        where: {
          ...lifecycleWhere(accountFilter),
          eventNameInternal: "lead_created",
          receivedAt: { gte: todayStart, lte: new Date() },
        },
      }),
      prisma.lifecycleEvent.count({
        where: {
          ...lifecycleWhere(accountFilter),
          eventNameInternal: "appointment_set",
          receivedAt: { gte: todayStart, lte: new Date() },
        },
      }),
      prisma.inboundContactIndex.count({ where: indexWhere(accountFilter) }),
      prisma.webhookRequestLog.count({
        where: {
          ...webhookWhere(accountFilter),
          receivedAt: { gte: last24h, lte: new Date() },
          OR: [{ processingStatus: "failed" }, { httpStatus: { gte: 500 } }],
        },
      }),
      prisma.webhookRequestLog.count({ where: webhookWhere(accountFilter) }),
      prisma.webhookRequestLog.count({
        where: {
          ...webhookWhere(accountFilter),
          OR: [{ processingStatus: "failed" }, { httpStatus: { gte: 500 } }],
        },
      }),
      countRemindersSent(accountFilter),
    ]);

    const lastWebhookAt = g._max.receivedAt?.toISOString() ?? null;

    accounts.push({
      clientAccountId,
      locationId,
      leadsToday,
      appointmentsToday,
      activeLeadPool,
      lastWebhookAt,
      failureCount24h,
      healthStatus: computeHealthStatus({
        webhookFailures,
        webhookTotal,
        signalFailures: 0,
        signalAttempts: 0,
        validationFailures: 0,
      }),
      warnings: accountWarnings({
        failureCount24h,
        lastWebhookAt,
        leadsToday,
        remindersSent,
      }),
    });
  }

  accounts.sort((a, b) => {
    const ta = a.lastWebhookAt ? new Date(a.lastWebhookAt).getTime() : 0;
    const tb = b.lastWebhookAt ? new Date(b.lastWebhookAt).getTime() : 0;
    return tb - ta;
  });

  return { ok: true, accounts, dataLimitations: ACCOUNTS_LIMITATIONS };
}
