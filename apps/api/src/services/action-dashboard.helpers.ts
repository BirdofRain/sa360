import type { InboundContactIndex } from "@prisma/client";
import {
  outboundLifecycleBadNumber,
  outboundLifecycleDoNotCall,
} from "../lib/synthflow-outbound-context.logic.js";
import type {
  ActionDashboardAiActivity,
  ActionDashboardAiActivityKind,
  ActionDashboardConnectionStatus,
  ActionDashboardPriorityLead,
  ActionDashboardPriorityReasonCode,
  ActionDashboardTodayResponse,
} from "../lib/action-dashboard-types.js";
import {
  contactDisplayName,
  inferAppointmentSource,
  parseLifecyclePayload,
  type LifecyclePayloadSlice,
} from "./automation-dashboard.helpers.js";
import type { ActionDashboardScope } from "./action-dashboard-scope.js";

export type LifecycleRowLite = {
  id: string;
  leadUid: string;
  contactIdGhl: string | null;
  eventNameInternal: string;
  receivedAt: Date;
  payloadJson: unknown;
};

export type SynthflowInboundLite = {
  id: string;
  receivedAt: Date;
  knownCaller: string | null;
  lookupStatus: string | null;
  contactIdGhl: string | null;
  customerName: string | null;
  processingStatus: string;
  errorSummary: string | null;
};

export type SynthflowOutboundLite = {
  id: string;
  receivedAt: Date;
  contactIdGhl: string | null;
  outcome: string;
  booked: boolean;
  appointmentTime: Date | null;
  transcriptSummary: string | null;
};

export type ActionDashboardRawData = {
  scope: ActionDashboardScope;
  clientName: string | null;
  contacts: InboundContactIndex[];
  lifecycleLookback: LifecycleRowLite[];
  lifecycleToday: LifecycleRowLite[];
  synthflowInbound: SynthflowInboundLite[];
  synthflowOutbound: SynthflowOutboundLite[];
  lastWebhookSuccessAt: Date | null;
  hasLifecycleRows: boolean;
  hasSynthflowInbound: boolean;
  hasSynthflowOutbound: boolean;
  hasWebhookSuccess: boolean;
  hasContacts: boolean;
};

const REVENUE_SIGNAL_EVENTS = new Set([
  "appointment_set",
  "appointment_confirmed",
  "appointment_showed",
  "quote_given",
  "sold",
  "sale_logged",
  "policy_issued",
  "signal_sent",
  "outcome_logged",
]);

const REPLY_EVENTS = new Set([
  "first_response",
  "contact_replied",
  "ai_engaged",
  "ai_responded",
  "contact_updated",
]);

const CALL_LOG_EVENTS = new Set([
  "call_attempt_logged",
  "call_connected",
  "call_no_answer",
]);

const MS_MIN = 60_000;
const MS_HOUR = 60 * MS_MIN;
const MS_DAY = 24 * MS_HOUR;

export function normStage(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

export function isSpamOrDeadStage(stage: string | null | undefined): boolean {
  const u = normStage(stage);
  if (!u) return false;
  return (
    u === "DEAD" ||
    u.includes("SPAM") ||
    u === "BAD_LEAD" ||
    outboundLifecycleDoNotCall(stage) ||
    outboundLifecycleBadNumber(stage)
  );
}

export function isExcludedContact(
  contact: InboundContactIndex,
  latestPayload: LifecyclePayloadSlice | null
): boolean {
  if (isSpamOrDeadStage(contact.lifecycleStage)) return true;
  const disp = (latestPayload?.state?.agent_disposition ?? "").toLowerCase();
  if (disp.includes("dnc") || disp.includes("do not call") || disp.includes("spam")) {
    return true;
  }
  if (latestPayload?.state?.dead_lead_flag === true) return true;
  return false;
}

export function contactDisplayFromIndex(c: InboundContactIndex): string {
  const dn = c.displayName?.trim();
  if (dn) return dn;
  const joined = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return joined || "Unknown contact";
}

export function contactKey(contactIdGhl: string | null, leadUid: string | null, phone: string): string {
  if (contactIdGhl?.trim()) return `ghl:${contactIdGhl.trim()}`;
  if (leadUid?.trim()) return `lead:${leadUid.trim()}`;
  return `phone:${phone}`;
}

export function groupLifecycleByContact(
  rows: LifecycleRowLite[]
): Map<string, LifecycleRowLite[]> {
  const map = new Map<string, LifecycleRowLite[]>();
  for (const row of rows) {
    const payload = parseLifecyclePayload(row.payloadJson);
    const phone =
      payload.contact?.phone_e164 ?? payload.contact?.phone ?? row.leadUid;
    const key = contactKey(
      row.contactIdGhl ?? payload.contact?.contact_id_ghl ?? null,
      row.leadUid ?? payload.contact?.lead_uid ?? null,
      phone
    );
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  }
  return map;
}

export type PriorityScoreResult = {
  score: number;
  reason: string;
  reasonCode: ActionDashboardPriorityReasonCode;
  dueBy: string | null;
  showWorkspace: boolean;
};

export function scorePriorityContact(args: {
  contact: InboundContactIndex;
  events: LifecycleRowLite[];
  outboundBooked: SynthflowOutboundLite[];
  now: Date;
}): PriorityScoreResult {
  const { contact, events, outboundBooked, now } = args;
  const nowMs = now.getTime();
  const latestPayload = events[0] ? parseLifecyclePayload(events[0].payloadJson) : null;
  const todayEvents = events.filter((e) => e.receivedAt >= utcStartOfDay(now));

  let score = 0;
  const reasons: Array<{ pts: number; reason: string; code: ActionDashboardPriorityReasonCode }> = [];

  const aptStatus = normStage(contact.appointmentStatus);
  const lcStage = normStage(contact.lifecycleStage);
  const isNoShow =
    aptStatus.includes("NO_SHOW") ||
    events.some((e) => e.eventNameInternal === "no_show") ||
    todayEvents.some((e) => {
      const p = parseLifecyclePayload(e.payloadJson);
      return normStage(p.state?.appointment_status).includes("NO_SHOW");
    });

  const appointmentSetToday = todayEvents.some((e) =>
    ["appointment_set", "ai_booked", "appointment_confirmed", "appointment_rescheduled"].includes(
      e.eventNameInternal
    )
  );
  const aiBookedOutbound = outboundBooked.some(
    (o) => o.booked && o.receivedAt >= utcStartOfDay(now)
  );
  const aiBookedLifecycle = todayEvents.some((e) => {
    if (!["appointment_set", "ai_booked"].includes(e.eventNameInternal)) return false;
    return inferAppointmentSource(e.eventNameInternal, parseLifecyclePayload(e.payloadJson), false) !== "AGENT";
  });

  if (appointmentSetToday || aiBookedOutbound) {
    const upcoming = outboundBooked.find((o) => o.appointmentTime && o.appointmentTime.getTime() > nowMs);
    if (upcoming?.appointmentTime) {
      const within24h = upcoming.appointmentTime.getTime() - nowMs <= MS_DAY;
      if (within24h) {
        score += 50;
        reasons.push({
          pts: 50,
          reason: "Appointment set — confirm before scheduled time",
          code: "ai_appointment_ready",
        });
      }
    } else if (appointmentSetToday) {
      score += 50;
      reasons.push({
        pts: 50,
        reason: "Appointment set today — confirm details",
        code: "ai_appointment_ready",
      });
    }
  }

  if (aiBookedOutbound || aiBookedLifecycle) {
    score += 45;
    reasons.push({
      pts: 45,
      reason: "AI / voice booked appointment — human confirmation needed",
      code: "ai_appointment_ready",
    });
  }

  const replyRecent = events.find(
    (e) =>
      REPLY_EVENTS.has(e.eventNameInternal) &&
      nowMs - e.receivedAt.getTime() <= MS_MIN
  );
  if (replyRecent) {
    score += 40;
    reasons.push({
      pts: 40,
      reason: "Recent reply — respond while intent is high",
      code: "hot_lead",
    });
  }

  if (
    appointmentSetToday ||
    outboundBooked.some((o) => o.appointmentTime && isSameUtcDay(o.appointmentTime, now))
  ) {
    score += 35;
    reasons.push({
      pts: 35,
      reason: "Appointment activity today",
      code: "ai_appointment_ready",
    });
  }

  const createdMs = contact.createdAt.getTime();
  if (nowMs - createdMs <= 30 * MS_MIN) {
    score += 30;
    reasons.push({
      pts: 30,
      reason: "New lead — first-touch window",
      code: "hot_lead",
    });
  } else if (events.some((e) => e.eventNameInternal === "lead_created" && nowMs - e.receivedAt.getTime() <= 30 * MS_MIN)) {
    score += 30;
    reasons.push({
      pts: 30,
      reason: "Lead created in the last 30 minutes",
      code: "hot_lead",
    });
  }

  if (isNoShow) {
    score += 25;
    reasons.push({
      pts: 25,
      reason: "No-show recovery — re-engage contact",
      code: "stale_follow_up",
    });
  }

  if (lcStage.includes("FOLLOW") || lcStage.includes("CALLBACK")) {
    score += 20;
    reasons.push({
      pts: 20,
      reason: "Follow-up due — stage indicates callback",
      code: "callback_due",
    });
  }

  if (nowMs - contact.lastSeenAt.getTime() <= MS_DAY) {
    score += 10;
    reasons.push({
      pts: 10,
      reason: "Recent activity in the last 24 hours",
      code: "hot_lead",
    });
  }

  if (
    events.some((e) => REVENUE_SIGNAL_EVENTS.has(e.eventNameInternal)) &&
    (lcStage.includes("POLICY") || lcStage.includes("REVIEW") || lcStage.includes("SALE"))
  ) {
    score += 15;
    reasons.push({
      pts: 15,
      reason: "Revenue signal — policy or sale progression",
      code: "revenue_signal",
    });
  }

  reasons.sort((a, b) => b.pts - a.pts);
  const top = reasons[0] ?? {
    pts: 5,
    reason: "Active lead — review next step",
    code: "hot_lead" as const,
  };

  let dueBy: string | null = null;
  const apt = outboundBooked.find((o) => o.appointmentTime)?.appointmentTime;
  if (apt && apt.getTime() > nowMs) {
    dueBy = apt.toISOString();
  } else if (score >= 40) {
    dueBy = new Date(nowMs + 2 * MS_HOUR).toISOString();
  }

  const showWorkspace =
    score >= 25 ||
    Boolean(contact.appointmentStatus) ||
    Boolean(contact.policyStatus) ||
    lcStage.includes("APPOINTMENT") ||
    lcStage.includes("HUMAN");

  return {
    score,
    reason: top.reason,
    reasonCode: top.code,
    dueBy,
    showWorkspace,
  };
}

function utcStartOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return utcStartOfDay(a).getTime() === utcStartOfDay(b).getTime();
}

export function buildWorkspaceNextAction(contact: InboundContactIndex): string {
  const stage = normStage(contact.lifecycleStage);
  const apt = normStage(contact.appointmentStatus);
  if (apt.includes("NO_SHOW")) return "No-show recovery call";
  if (stage.includes("APPOINTMENT")) return "Confirm appointment & pre-call prep";
  if (stage.includes("HUMAN") || stage.includes("ACTIVATION")) {
    return "Complete human activation steps";
  }
  if (stage.includes("FOLLOW") || stage.includes("CALLBACK")) {
    return "Return missed follow-up";
  }
  if (stage === "NEW" || stage.includes("ATTEMPT")) {
    return "First human outreach";
  }
  return "Review lead and log next step";
}

export function resolveConnectionStatus(
  lastSuccessAt: Date | null,
  now: Date
): { status: ActionDashboardConnectionStatus; message: string } {
  if (!lastSuccessAt) {
    return {
      status: "disconnected",
      message: "No successful GHL lifecycle webhook observed for this scope.",
    };
  }
  const ageMs = now.getTime() - lastSuccessAt.getTime();
  if (ageMs <= MS_DAY) {
    return {
      status: "connected",
      message: `Last successful lifecycle webhook ${Math.round(ageMs / MS_MIN)} minutes ago.`,
    };
  }
  return {
    status: "degraded",
    message: `Last successful lifecycle webhook ${Math.round(ageMs / MS_HOUR)} hours ago (older than 24h).`,
  };
}

export function buildAiActivityFeed(args: {
  lifecycle: LifecycleRowLite[];
  inbound: SynthflowInboundLite[];
  outbound: SynthflowOutboundLite[];
  contactNames: Map<string, string>;
}): ActionDashboardAiActivity[] {
  const items: ActionDashboardAiActivity[] = [];

  for (const row of args.lifecycle) {
    const name = row.contactIdGhl ? args.contactNames.get(row.contactIdGhl) ?? null : null;
    const payload = parseLifecyclePayload(row.payloadJson);
    const display =
      name ?? contactDisplayName(payload) ?? (row.contactIdGhl ? "Contact" : null);

    if (
      row.eventNameInternal === "appointment_set" ||
      row.eventNameInternal === "ai_booked" ||
      row.eventNameInternal === "appointment_confirmed"
    ) {
      items.push({
        id: `lc_${row.id}`,
        at: row.receivedAt.toISOString(),
        kind: "appointment",
        title: "Appointment set (lifecycle)",
        detail: display ?? row.eventNameInternal,
        contactIdGhl: row.contactIdGhl,
        displayName: display,
      });
      continue;
    }
    if (row.eventNameInternal === "ai_engaged" || row.eventNameInternal === "first_response") {
      items.push({
        id: `lc_${row.id}`,
        at: row.receivedAt.toISOString(),
        kind: row.eventNameInternal === "first_response" ? "sms" : "voice",
        title: row.eventNameInternal === "first_response" ? "First response" : "AI engaged",
        detail: display,
        contactIdGhl: row.contactIdGhl,
        displayName: display,
      });
      continue;
    }
    if (row.eventNameInternal === "human_activation_needed") {
      items.push({
        id: `lc_${row.id}`,
        at: row.receivedAt.toISOString(),
        kind: "handoff",
        title: "Human activation needed",
        detail: display,
        contactIdGhl: row.contactIdGhl,
        displayName: display,
      });
    }
  }

  for (const row of args.inbound) {
    const known = (row.knownCaller ?? "").toLowerCase() === "true" || row.knownCaller === "1";
    const kind: ActionDashboardAiActivityKind = known ? "voice" : "routing";
    items.push({
      id: `sf_in_${row.id}`,
      at: row.receivedAt.toISOString(),
      kind,
      title: known ? "Inbound Synthflow caller matched" : "Unknown inbound caller",
      detail: row.customerName ?? row.lookupStatus ?? row.processingStatus,
      contactIdGhl: row.contactIdGhl,
      displayName: row.customerName,
    });
  }

  for (const row of args.outbound) {
    const kind: ActionDashboardAiActivityKind = row.booked ? "appointment" : "voice";
    items.push({
      id: `sf_out_${row.id}`,
      at: row.receivedAt.toISOString(),
      kind,
      title: row.booked ? "Outbound voice — appointment booked" : `Outbound voice — ${row.outcome}`,
      detail: row.transcriptSummary?.slice(0, 120) ?? null,
      contactIdGhl: row.contactIdGhl,
      displayName: row.contactIdGhl ? args.contactNames.get(row.contactIdGhl) ?? null : null,
    });
  }

  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return items.slice(0, 10);
}

export function buildActionDashboardFromData(
  data: ActionDashboardRawData
): ActionDashboardTodayResponse {
  const { scope, contacts, lifecycleLookback, lifecycleToday, synthflowInbound, synthflowOutbound } =
    data;
  const warnings: string[] = [];

  if (!scope.subaccountIdGhl) {
    warnings.push("locationId not provided — showing client-level data across subaccounts.");
  }
  if (!data.hasLifecycleRows) {
    warnings.push("No recent lifecycle events found for this scope.");
  }
  if (!data.hasWebhookSuccess) {
    warnings.push("No recent successful lifecycle webhook records found.");
  }
  if (!data.hasSynthflowInbound) {
    warnings.push("No Synthflow inbound lookup logs found in lookback window.");
  }
  if (!data.hasSynthflowOutbound) {
    warnings.push("No Synthflow outbound result logs found in lookback window.");
  }

  const lifecycleByContact = groupLifecycleByContact(lifecycleLookback);
  const outboundByContact = new Map<string, SynthflowOutboundLite[]>();
  for (const o of synthflowOutbound) {
    if (!o.contactIdGhl) continue;
    const list = outboundByContact.get(o.contactIdGhl) ?? [];
    list.push(o);
    outboundByContact.set(o.contactIdGhl, list);
  }

  const contactNames = new Map<string, string>();
  for (const c of contacts) {
    if (c.contactIdGhl) contactNames.set(c.contactIdGhl, contactDisplayFromIndex(c));
  }

  const scored: Array<{ contact: InboundContactIndex; scored: PriorityScoreResult }> = [];
  for (const contact of contacts) {
    if (!contact.contactIdGhl?.trim() || !contact.phoneE164?.trim()) continue;
    const key = contactKey(contact.contactIdGhl, contact.leadUid, contact.phoneE164);
    const events = lifecycleByContact.get(key) ?? [];
    const latestPayload = events[0] ? parseLifecyclePayload(events[0].payloadJson) : null;
    if (isExcludedContact(contact, latestPayload)) continue;

    const outbound = outboundByContact.get(contact.contactIdGhl) ?? [];
    const result = scorePriorityContact({
      contact,
      events,
      outboundBooked: outbound,
      now: scope.now,
    });
    if (result.score <= 0) continue;
    scored.push({ contact, scored: result });
  }

  scored.sort((a, b) => b.scored.score - a.scored.score);
  const top = scored.slice(0, 10);

  const priorityLeads: ActionDashboardPriorityLead[] = top.map(({ contact, scored: s }, i) => {
    const key = contactKey(contact.contactIdGhl, contact.leadUid, contact.phoneE164);
    const events = lifecycleByContact.get(key) ?? [];
    const lastTouch = events[0]?.receivedAt ?? contact.lastSeenAt;

    const workspace = s.showWorkspace
      ? {
          nextAction: buildWorkspaceNextAction(contact),
          appointmentStatus: contact.appointmentStatus,
          policyStatus: contact.policyStatus,
          ownerName: contact.assignedAgentName,
          lastActivityAt: (events[0]?.receivedAt ?? contact.lastSeenAt).toISOString(),
        }
      : null;

    return {
      rank: i + 1,
      priorityScore: s.score,
      contactIdGhl: contact.contactIdGhl!,
      leadUid: contact.leadUid,
      displayName: contactDisplayFromIndex(contact),
      phoneE164: contact.phoneE164,
      reason: s.reason,
      reasonCode: s.reasonCode,
      dueBy: s.dueBy,
      estimatedPremium: null,
      lifecycleStage: contact.lifecycleStage,
      lastTouchAt: lastTouch.toISOString(),
      workspace,
    };
  });

  let aiAppointmentsToday = 0;
  let aiSourcePartial = false;
  for (const ev of lifecycleToday) {
    if (ev.eventNameInternal !== "appointment_set") continue;
    const src = inferAppointmentSource(
      ev.eventNameInternal,
      parseLifecyclePayload(ev.payloadJson),
      false
    );
    if (src === "AI" || src === "BOT") aiAppointmentsToday += 1;
    else aiSourcePartial = true;
  }
  aiAppointmentsToday += synthflowOutbound.filter(
    (o) => o.booked && o.receivedAt >= scope.todayStart
  ).length;
  if (aiSourcePartial && aiAppointmentsToday === 0) {
    const fallbackCount = lifecycleToday.filter((e) =>
      ["appointment_set", "ai_booked"].includes(e.eventNameInternal)
    ).length;
    if (fallbackCount > 0) {
      aiAppointmentsToday = fallbackCount;
      warnings.push(
        "AI appointment source attribution is partial — counting all appointment_set events for today."
      );
    }
  }

  const hotActionsWaiting = priorityLeads.filter((p) => p.priorityScore >= 40).length;

  const callsLoggedToday = lifecycleToday.filter((e) =>
    CALL_LOG_EVENTS.has(e.eventNameInternal)
  ).length;
  if (callsLoggedToday === 0) {
    warnings.push(
      "No call_* lifecycle events today — callsLoggedToday counts call_attempt_logged, call_connected, and call_no_answer."
    );
  }

  const revenueSignalsToday = lifecycleToday.filter((e) =>
    REVENUE_SIGNAL_EVENTS.has(e.eventNameInternal)
  ).length;

  const conn = resolveConnectionStatus(data.lastWebhookSuccessAt, scope.now);
  const locationName =
    data.clientName?.trim() ||
    (scope.subaccountIdGhl ? scope.subaccountIdGhl : scope.clientAccountId);

  const aiActivity = buildAiActivityFeed({
    lifecycle: [...lifecycleLookback].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()
    ),
    inbound: synthflowInbound,
    outbound: synthflowOutbound,
    contactNames,
  });

  return {
    ok: true,
    generatedAt: scope.now.toISOString(),
    subaccount: {
      clientAccountId: scope.clientAccountId,
      locationId: scope.locationIdForResponse || scope.subaccountIdGhl || "",
      locationName,
      agentDisplayName: scope.agentDisplayName ?? null,
      connectionStatus: conn.status,
      lastSyncAt: data.lastWebhookSuccessAt?.toISOString() ?? null,
      syncMessage: conn.message,
    },
    summary: {
      aiAppointmentsToday,
      hotActionsWaiting,
      callsLoggedToday,
      revenueSignalsToday,
    },
    priorityLeads,
    aiActivity,
    setupWarnings: warnings,
  };
}

export function emptyActionDashboardResponse(
  scope: ActionDashboardScope,
  warnings: string[]
): ActionDashboardTodayResponse {
  const conn = resolveConnectionStatus(null, scope.now);
  const setupWarnings = [
    ...warnings,
    "No call_* lifecycle events today — callsLoggedToday counts call_attempt_logged, call_connected, and call_no_answer.",
  ];
  return {
    ok: true,
    generatedAt: scope.now.toISOString(),
    subaccount: {
      clientAccountId: scope.clientAccountId,
      locationId: scope.locationIdForResponse,
      locationName: scope.subaccountIdGhl ?? scope.clientAccountId,
      agentDisplayName: scope.agentDisplayName ?? null,
      connectionStatus: conn.status,
      lastSyncAt: null,
      syncMessage: conn.message,
    },
    summary: {
      aiAppointmentsToday: 0,
      hotActionsWaiting: 0,
      callsLoggedToday: 0,
      revenueSignalsToday: 0,
    },
    priorityLeads: [],
    aiActivity: [],
    setupWarnings,
  };
}
