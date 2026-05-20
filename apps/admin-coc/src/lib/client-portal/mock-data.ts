import type { ClientPortalDashboard, ClientPortalRangeKey } from "./types.ts";
import { getClientPortalDisplayName, getClientPortalLocationLabel } from "./config.ts";
import { rangeLabel, resolveRangeBounds } from "./range.ts";

function scaleForRange(key: ClientPortalRangeKey): number {
  switch (key) {
    case "30d":
      return 3.2;
    case "mtd":
      return 2.1;
    default:
      return 1;
  }
}

function round(n: number): number {
  return Math.max(0, Math.round(n));
}

function buildFunnel(key: ClientPortalRangeKey) {
  const s = scaleForRange(key);
  const leadsReceived = round(42 * s);
  const replied = round(28 * s);
  const appointmentsSet = round(9 * s);
  const appointmentsShowed = round(6 * s);
  const sold = round(2 * s);

  const replyRate = leadsReceived > 0 ? replied / leadsReceived : 0;
  const setRate = leadsReceived > 0 ? appointmentsSet / leadsReceived : 0;
  const showRate = appointmentsSet > 0 ? appointmentsShowed / appointmentsSet : 0;
  const soldRate = appointmentsShowed > 0 ? sold / appointmentsShowed : 0;

  return {
    leadsReceived,
    replied,
    appointmentsSet,
    appointmentsShowed,
    sold,
    conversion: {
      replyRate: Math.round(replyRate * 1000) / 1000,
      setRate: Math.round(setRate * 1000) / 1000,
      showRate: Math.round(showRate * 1000) / 1000,
      soldRate: Math.round(soldRate * 1000) / 1000,
    },
  };
}

/** Phase 1 mock dashboard — replace with API in Phase 2. */
export function buildMockClientPortalDashboard(
  rangeKey: ClientPortalRangeKey,
  now = new Date()
): ClientPortalDashboard {
  const { from, to } = resolveRangeBounds(rangeKey, now);
  const funnel = buildFunnel(rangeKey);
  const generatedAt = now.toISOString();

  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

  return {
    ok: true,
    generatedAt,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      key: rangeKey,
      label: rangeLabel(rangeKey),
    },
    client: {
      displayName: getClientPortalDisplayName(),
      locationLabel: getClientPortalLocationLabel(),
    },
    systemHealth: {
      status: "healthy",
      headline: "Your lead system is active and receiving updates",
      lastActivityAt: hoursAgo(0.25),
      checks: [
        {
          id: "lifecycle_feed",
          label: "Lead updates",
          status: "ok",
          detail: "New leads and status changes are flowing in",
        },
        {
          id: "appointments",
          label: "Appointments",
          status: "ok",
          detail: `${funnel.appointmentsSet} appointments set in this period`,
        },
        {
          id: "crm_snapshot",
          label: "Contact snapshot",
          status: funnel.appointmentsShowed < funnel.appointmentsSet ? "warn" : "ok",
          detail:
            funnel.appointmentsShowed < funnel.appointmentsSet
              ? "A few appointments still need a show confirmation"
              : "Contact records look up to date",
        },
      ],
    },
    funnel,
    recentActivity: [
      {
        id: "act_1",
        at: hoursAgo(1),
        kind: "appointment",
        title: "Appointment set",
        subtitle: "Maria G.",
      },
      {
        id: "act_2",
        at: hoursAgo(3),
        kind: "reply",
        title: "Lead replied",
        subtitle: "James T.",
      },
      {
        id: "act_3",
        at: hoursAgo(5),
        kind: "voice",
        title: "AI call completed",
        subtitle: "Patricia L. — booking offered",
      },
      {
        id: "act_4",
        at: hoursAgo(8),
        kind: "show",
        title: "Appointment completed",
        subtitle: "Robert K.",
      },
      {
        id: "act_5",
        at: hoursAgo(12),
        kind: "lead",
        title: "New lead received",
        subtitle: "Campaign: Facebook — Q2",
      },
      {
        id: "act_6",
        at: hoursAgo(18),
        kind: "sold",
        title: "Sale recorded",
        subtitle: "Susan M.",
      },
    ],
    appointmentsNeedingAttention: [
      {
        contactIdGhl: "demo_contact_1",
        displayName: "David R.",
        reason: "No-show — reach out today",
        reasonCode: "no_show",
        appointmentStatus: "No Show",
        lastActivityAt: hoursAgo(4),
      },
      {
        contactIdGhl: "demo_contact_2",
        displayName: "Emily W.",
        reason: "Appointment tomorrow — confirm attendance",
        reasonCode: "needs_confirmation",
        appointmentStatus: "Scheduled",
        lastActivityAt: hoursAgo(6),
      },
      {
        contactIdGhl: "demo_contact_3",
        displayName: "Michael B.",
        reason: "Follow up after quote",
        reasonCode: "follow_up",
        appointmentStatus: "Showed",
        lastActivityAt: hoursAgo(10),
      },
    ],
    leadSources: [
      {
        label: "Facebook — Vet Q2",
        sourcePlatform: "meta",
        leadCount: round(18 * scaleForRange(rangeKey)),
        appointmentsSet: round(4 * scaleForRange(rangeKey)),
      },
      {
        label: "Google — Search",
        sourcePlatform: "google",
        leadCount: round(12 * scaleForRange(rangeKey)),
        appointmentsSet: round(3 * scaleForRange(rangeKey)),
      },
      {
        label: "Referral partner",
        sourcePlatform: "referral",
        leadCount: round(8 * scaleForRange(rangeKey)),
        appointmentsSet: round(2 * scaleForRange(rangeKey)),
      },
      {
        label: "Website form",
        sourcePlatform: "web",
        leadCount: round(4 * scaleForRange(rangeKey)),
        appointmentsSet: round(0 * scaleForRange(rangeKey)),
      },
    ],
    aiVoice: {
      enabled: true,
      inboundCalls: round(12 * scaleForRange(rangeKey)),
      aiAppointmentsBooked: round(3 * scaleForRange(rangeKey)),
      lastVoiceActivityAt: hoursAgo(2),
    },
  };
}

/** Mock variant with AI/voice disabled — for UI tests. */
export function buildMockClientPortalDashboardNoVoice(
  rangeKey: ClientPortalRangeKey
): ClientPortalDashboard {
  const base = buildMockClientPortalDashboard(rangeKey);
  return {
    ...base,
    aiVoice: {
      enabled: false,
      inboundCalls: 0,
      aiAppointmentsBooked: 0,
      lastVoiceActivityAt: null,
    },
  };
}
