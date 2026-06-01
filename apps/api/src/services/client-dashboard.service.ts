import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db.js";
import type { ClientPortalTenantConfig } from "../lib/client-portal-auth.js";
import {
  type ClientDashboardDateRange,
  rangeLabel,
} from "../schemas/client-dashboard.schema.js";
import {
  lifecycleWhere,
  indexWhere,
  parseLifecyclePayload,
  contactDisplayName,
  webhookWhere,
} from "./automation-dashboard.helpers.js";
import { computeHealthStatus } from "./automation-dashboard.service.js";
import type { AutomationDashboardFilters } from "../schemas/automation-dashboard.schema.js";
import {
  buildAppointmentsDetail,
  buildEmptyHealthHeadline,
  buildLeadUpdatesDetail,
  CLIENT_PORTAL_REPLY_EVENTS,
  CLIENT_PORTAL_SOLD_EVENTS,
  computeFunnelConversion,
  mapAutomationHealthToClient,
  NEEDS_CONFIRM_STATUSES,
  NO_SHOW_STATUSES,
  presentLifecycleActivity,
} from "./client-dashboard.helpers.js";

export type ClientDashboardResponse = {
  ok: true;
  generatedAt: string;
  range: { from: string; to: string; key: string; label: string };
  client: {
    displayName: string;
    locationLabel?: string | null;
    nicheLabels?: string[];
    productLabels?: string[];
  };
  systemHealth: {
    status: "healthy" | "needs_attention" | "disconnected";
    headline: string;
    lastActivityAt: string;
    checks: Array<{
      id: string;
      label: string;
      status: "ok" | "warn" | "error";
      detail: string;
    }>;
  };
  funnel: {
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
  recentActivity: Array<{
    id: string;
    at: string;
    kind: string;
    title: string;
    subtitle?: string | null;
  }>;
  appointmentsNeedingAttention: Array<{
    contactIdGhl: string;
    displayName: string;
    reason: string;
    reasonCode: "upcoming" | "no_show" | "needs_confirmation" | "follow_up";
    appointmentStatus?: string | null;
    lastActivityAt: string;
  }>;
  leadSources: Array<{
    label: string;
    sourcePlatform?: string | null;
    leadCount: number;
    appointmentsSet: number;
  }>;
  aiVoice: {
    enabled: boolean;
    inboundCalls: number;
    aiAppointmentsBooked: number;
    lastVoiceActivityAt: string | null;
  };
};

export type ClientDashboardServiceParams = {
  tenant: ClientPortalTenantConfig;
  range: ClientDashboardDateRange;
};

export type ClientDashboardServiceDeps = {
  prisma: PrismaClient;
  now: () => Date;
};

function toFilters(
  tenant: ClientPortalTenantConfig,
  range: ClientDashboardDateRange
): AutomationDashboardFilters {
  return {
    clientAccountId: tenant.clientAccountId,
    subaccountIdGhl: tenant.subaccountIdGhl,
    from: range.from,
    to: range.to,
  };
}

async function countLifecycle(
  db: PrismaClient,
  f: AutomationDashboardFilters,
  eventNameInternal: string
) {
  return db.lifecycleEvent.count({
    where: { ...lifecycleWhere(f), eventNameInternal },
  });
}

async function distinctLeadUidsForEvents(
  db: PrismaClient,
  f: AutomationDashboardFilters,
  eventNames: readonly string[]
) {
  const rows = await db.lifecycleEvent.findMany({
    where: {
      ...lifecycleWhere(f),
      eventNameInternal: { in: [...eventNames] },
    },
    select: { leadUid: true },
    distinct: ["leadUid"],
  });
  return rows.length;
}

function contactSubtitle(payload: unknown): string | null {
  const p = parseLifecyclePayload(payload);
  return contactDisplayName(p);
}

export async function getClientDashboard(
  params: ClientDashboardServiceParams,
  deps: ClientDashboardServiceDeps = { prisma: defaultPrisma, now: () => new Date() }
): Promise<ClientDashboardResponse> {
  const { tenant, range } = params;
  const db = deps.prisma;
  const now = deps.now();
  const f = toFilters(tenant, range);
  const baseWebhook = webhookWhere(f);

  const [
    leadsReceived,
    replied,
    appointmentsSet,
    appointmentsShowed,
    sold,
    recentRows,
    indexRows,
    inboundCalls,
    aiBooked,
    lastInbound,
    lastOutbound,
    lastLifecycle,
    webhookFailures,
    webhookTotal,
    webhookValidationFailures,
    clientConfig,
    clientAccount,
    leadCreatedRows,
  ] = await Promise.all([
    countLifecycle(db, f, "lead_created"),
    distinctLeadUidsForEvents(db, f, CLIENT_PORTAL_REPLY_EVENTS),
    countLifecycle(db, f, "appointment_set"),
    countLifecycle(db, f, "appointment_showed"),
    distinctLeadUidsForEvents(db, f, CLIENT_PORTAL_SOLD_EVENTS),
    db.lifecycleEvent.findMany({
      where: lifecycleWhere(f),
      orderBy: { receivedAt: "desc" },
      take: 30,
      select: {
        id: true,
        receivedAt: true,
        eventNameInternal: true,
        payloadJson: true,
        contactIdGhl: true,
      },
    }),
    db.inboundContactIndex.findMany({
      where: indexWhere(f),
      orderBy: { lastSeenAt: "desc" },
      take: 200,
      select: {
        contactIdGhl: true,
        displayName: true,
        firstName: true,
        lastName: true,
        appointmentStatus: true,
        lifecycleStage: true,
        lastSeenAt: true,
      },
    }),
    db.synthflowRequestLog.count({
      where: {
        receivedAt: { gte: f.from, lte: f.to },
        clientAccountId: tenant.clientAccountId,
        ...(tenant.subaccountIdGhl ? { subaccountIdGhl: tenant.subaccountIdGhl } : {}),
      },
    }),
    db.synthflowOutboundResultLog.count({
      where: {
        receivedAt: { gte: f.from, lte: f.to },
        booked: true,
        clientAccountId: tenant.clientAccountId,
        ...(tenant.subaccountIdGhl ? { subaccountIdGhl: tenant.subaccountIdGhl } : {}),
      },
    }),
    db.synthflowRequestLog.findFirst({
      where: {
        receivedAt: { gte: f.from, lte: f.to },
        clientAccountId: tenant.clientAccountId,
        ...(tenant.subaccountIdGhl ? { subaccountIdGhl: tenant.subaccountIdGhl } : {}),
      },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    db.synthflowOutboundResultLog.findFirst({
      where: {
        receivedAt: { gte: f.from, lte: f.to },
        clientAccountId: tenant.clientAccountId,
        ...(tenant.subaccountIdGhl ? { subaccountIdGhl: tenant.subaccountIdGhl } : {}),
      },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    db.lifecycleEvent.findFirst({
      where: lifecycleWhere(f),
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    db.webhookRequestLog.count({
      where: {
        ...baseWebhook,
        OR: [{ processingStatus: "failed" }, { httpStatus: { gte: 500 } }],
      },
    }),
    db.webhookRequestLog.count({ where: baseWebhook }),
    db.webhookRequestLog.count({
      where: { ...baseWebhook, processingStatus: "validation_failed" },
    }),
    db.clientConfig.findUnique({
      where: { clientAccountId: tenant.clientAccountId },
      select: { clientName: true },
    }),
    db.clientAccount.findUnique({
      where: { clientAccountId: tenant.clientAccountId },
      include: { ghlDestination: true },
    }),
    db.lifecycleEvent.findMany({
      where: { ...lifecycleWhere(f), eventNameInternal: "lead_created" },
      select: { leadUid: true },
      distinct: ["leadUid"],
    }),
  ]);

  const funnel = {
    leadsReceived,
    replied,
    appointmentsSet,
    appointmentsShowed,
    sold,
    conversion: computeFunnelConversion({
      leadsReceived,
      replied,
      appointmentsSet,
      appointmentsShowed,
      sold,
    }),
  };

  const internalHealth = computeHealthStatus({
    webhookFailures,
    webhookTotal,
    signalFailures: 0,
    signalAttempts: 0,
    validationFailures: webhookValidationFailures,
  });
  const healthStatus = mapAutomationHealthToClient(internalHealth);

  const lastActivityAt =
    lastLifecycle?.receivedAt ??
    lastInbound?.receivedAt ??
    lastOutbound?.receivedAt ??
    range.to;

  const recentActivity: ClientDashboardResponse["recentActivity"] = [];
  for (const row of recentRows) {
    const presentation = presentLifecycleActivity(row.eventNameInternal);
    if (!presentation) continue;
    recentActivity.push({
      id: row.id,
      at: row.receivedAt.toISOString(),
      kind: presentation.kind,
      title: presentation.title,
      subtitle: contactSubtitle(row.payloadJson),
    });
    if (recentActivity.length >= 12) break;
  }

  const appointmentsNeedingAttention: ClientDashboardResponse["appointmentsNeedingAttention"] =
    [];
  for (const c of indexRows) {
    if (!c.contactIdGhl) continue;
    const name =
      c.displayName?.trim() ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      "Contact";
    const apt = (c.appointmentStatus ?? "").trim();
    const aptLower = apt.toLowerCase();

    if (NO_SHOW_STATUSES.some((s) => aptLower === s.toLowerCase())) {
      appointmentsNeedingAttention.push({
        contactIdGhl: c.contactIdGhl,
        displayName: name,
        reason: "No-show — follow up with this contact",
        reasonCode: "no_show",
        appointmentStatus: apt || null,
        lastActivityAt: c.lastSeenAt.toISOString(),
      });
      continue;
    }

    if (
      NEEDS_CONFIRM_STATUSES.some((s) => aptLower === s.toLowerCase()) ||
      aptLower.includes("schedul")
    ) {
      appointmentsNeedingAttention.push({
        contactIdGhl: c.contactIdGhl,
        displayName: name,
        reason: "Confirm upcoming appointment",
        reasonCode: "needs_confirmation",
        appointmentStatus: apt || null,
        lastActivityAt: c.lastSeenAt.toISOString(),
      });
      continue;
    }

    const stage = (c.lifecycleStage ?? "").toLowerCase();
    if (stage.includes("follow") || stage.includes("callback")) {
      appointmentsNeedingAttention.push({
        contactIdGhl: c.contactIdGhl,
        displayName: name,
        reason: "Follow-up recommended",
        reasonCode: "follow_up",
        appointmentStatus: apt || null,
        lastActivityAt: c.lastSeenAt.toISOString(),
      });
    }

    if (appointmentsNeedingAttention.length >= 8) break;
  }

  const leadUids = leadCreatedRows.map((r) => r.leadUid).filter(Boolean);
  const attributions =
    leadUids.length > 0
      ? await db.leadAttribution.findMany({
          where: { leadUid: { in: leadUids } },
          select: {
            leadUid: true,
            campaignName: true,
            sourcePlatform: true,
            utmCampaign: true,
          },
        })
      : [];

  const aptSetByLead = new Map<string, number>();
  if (leadUids.length > 0) {
    const aptRows = await db.lifecycleEvent.findMany({
      where: {
        ...lifecycleWhere(f),
        eventNameInternal: "appointment_set",
        leadUid: { in: leadUids },
      },
      select: { leadUid: true },
      distinct: ["leadUid"],
    });
    for (const r of aptRows) aptSetByLead.set(r.leadUid, 1);
  }

  const sourceMap = new Map<
    string,
    { label: string; sourcePlatform: string | null; leadCount: number; appointmentsSet: number }
  >();
  for (const a of attributions) {
    const label =
      a.campaignName?.trim() ||
      a.utmCampaign?.trim() ||
      (a.sourcePlatform ? `${a.sourcePlatform} leads` : "Other");
    const key = label.toLowerCase();
    const existing = sourceMap.get(key);
    const hasApt = aptSetByLead.has(a.leadUid) ? 1 : 0;
    if (existing) {
      existing.leadCount += 1;
      existing.appointmentsSet += hasApt;
    } else {
      sourceMap.set(key, {
        label,
        sourcePlatform: a.sourcePlatform ?? null,
        leadCount: 1,
        appointmentsSet: hasApt,
      });
    }
  }

  const leadSources = [...sourceMap.values()]
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, 8);

  const lastVoiceMs = Math.max(
    lastInbound?.receivedAt?.getTime() ?? 0,
    lastOutbound?.receivedAt?.getTime() ?? 0
  );

  const snapshotStale =
    indexRows.length > 0 &&
    appointmentsSet > appointmentsShowed &&
    appointmentsSet > 0;

  return {
    ok: true,
    generatedAt: now.toISOString(),
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      key: range.rangeKey,
      label: rangeLabel(range.rangeKey),
    },
    client: (() => {
      const niches = Array.isArray(clientAccount?.primaryNicheKeys)
        ? (clientAccount!.primaryNicheKeys as string[]).filter((v) => typeof v === "string")
        : [];
      const products = Array.isArray(clientAccount?.primaryProductTypes)
        ? (clientAccount!.primaryProductTypes as string[]).filter((v) => typeof v === "string")
        : [];
      const displayName =
        clientAccount?.portalDisplayName?.trim() ||
        clientAccount?.clientDisplayName?.trim() ||
        clientConfig?.clientName?.trim() ||
        "Your business";
      const locationLabel =
        clientAccount?.ghlDestination?.locationName?.trim() ||
        tenant.subaccountIdGhl ||
        null;
      return {
        displayName,
        locationLabel,
        ...(niches.length ? { nicheLabels: niches } : {}),
        ...(products.length ? { productLabels: products } : {}),
      };
    })(),
    systemHealth: {
      status: leadsReceived === 0 && webhookTotal === 0 ? "needs_attention" : healthStatus,
      headline: buildEmptyHealthHeadline(leadsReceived),
      lastActivityAt: lastActivityAt.toISOString(),
      checks: [
        {
          id: "lifecycle_feed",
          label: "Lead updates",
          status: leadsReceived > 0 ? "ok" : "warn",
          detail: buildLeadUpdatesDetail(leadsReceived),
        },
        {
          id: "appointments",
          label: "Appointments",
          status: appointmentsSet > 0 ? "ok" : "warn",
          detail: buildAppointmentsDetail(appointmentsSet),
        },
        {
          id: "crm_snapshot",
          label: "Contact snapshot",
          status: snapshotStale ? "warn" : indexRows.length > 0 ? "ok" : "warn",
          detail:
            recentActivity.length === 0
              ? "No recent activity yet"
              : snapshotStale
                ? "Some appointments may still need confirmation"
                : "Contact records are updating",
        },
      ],
    },
    funnel,
    recentActivity,
    appointmentsNeedingAttention: appointmentsNeedingAttention.slice(0, 8),
    leadSources,
    aiVoice: {
      enabled: inboundCalls > 0 || aiBooked > 0,
      inboundCalls,
      aiAppointmentsBooked: aiBooked,
      lastVoiceActivityAt: lastVoiceMs > 0 ? new Date(lastVoiceMs).toISOString() : null,
    },
  };
}
