import { prisma } from "../lib/db.js";
import { getSeededActionDashboardToday } from "../lib/action-dashboard-seed.js";
import type { ActionDashboardTodayResponse } from "../lib/action-dashboard-types.js";
import {
  buildActionDashboardFromData,
  emptyActionDashboardResponse,
  type ActionDashboardRawData,
} from "./action-dashboard.helpers.js";
import {
  inboundIndexWhere,
  lifecycleWhere,
  resolveActionDashboardScope,
  synthflowOutboundWhere,
  synthflowRequestWhere,
  webhookSuccessWhere,
  webhookWhere,
} from "./action-dashboard-scope.js";

export type ActionDashboardTodayParams = {
  clientAccountId: string;
  locationId?: string;
  agentDisplayName?: string;
};

export type ActionDashboardServiceDeps = {
  prisma: typeof prisma;
  now: () => Date;
  nodeEnv: string;
};

const defaultDeps: ActionDashboardServiceDeps = {
  prisma,
  now: () => new Date(),
  nodeEnv: process.env.NODE_ENV ?? "development",
};

const LIFECYCLE_SELECT = {
  id: true,
  leadUid: true,
  contactIdGhl: true,
  eventNameInternal: true,
  receivedAt: true,
  payloadJson: true,
} as const;

export async function loadActionDashboardRawData(
  params: ActionDashboardTodayParams,
  deps: ActionDashboardServiceDeps = defaultDeps
): Promise<ActionDashboardRawData> {
  const scope = resolveActionDashboardScope({
    clientAccountId: params.clientAccountId,
    locationId: params.locationId,
    agentDisplayName: params.agentDisplayName,
    now: deps.now(),
  });

  const todayRange = { gte: scope.todayStart, lte: scope.now };
  const lookbackRange = { gte: scope.lookbackStart, lte: scope.now };

  const [
    clientConfig,
    contacts,
    lifecycleLookback,
    lifecycleToday,
    synthflowInbound,
    synthflowOutbound,
    lastWebhook,
    lifecycleAny,
    webhookAny,
    synthflowInAny,
    synthflowOutAny,
    contactAny,
  ] = await Promise.all([
    deps.prisma.clientConfig.findUnique({
      where: { clientAccountId: scope.clientAccountId },
      select: { clientName: true },
    }),
    deps.prisma.inboundContactIndex.findMany({
      where: inboundIndexWhere(scope),
      orderBy: { lastSeenAt: "desc" },
      take: 80,
    }),
    deps.prisma.lifecycleEvent.findMany({
      where: lifecycleWhere(scope, lookbackRange),
      orderBy: { receivedAt: "desc" },
      take: 400,
      select: LIFECYCLE_SELECT,
    }),
    deps.prisma.lifecycleEvent.findMany({
      where: lifecycleWhere(scope, todayRange),
      orderBy: { receivedAt: "desc" },
      take: 200,
      select: LIFECYCLE_SELECT,
    }),
    deps.prisma.synthflowRequestLog.findMany({
      where: synthflowRequestWhere(scope, lookbackRange),
      orderBy: { receivedAt: "desc" },
      take: 50,
      select: {
        id: true,
        receivedAt: true,
        knownCaller: true,
        lookupStatus: true,
        contactIdGhl: true,
        customerName: true,
        processingStatus: true,
        errorSummary: true,
      },
    }),
    deps.prisma.synthflowOutboundResultLog.findMany({
      where: synthflowOutboundWhere(scope, lookbackRange),
      orderBy: { receivedAt: "desc" },
      take: 50,
      select: {
        id: true,
        receivedAt: true,
        contactIdGhl: true,
        outcome: true,
        booked: true,
        appointmentTime: true,
        transcriptSummary: true,
      },
    }),
    deps.prisma.webhookRequestLog.findFirst({
      where: webhookSuccessWhere(scope),
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    deps.prisma.lifecycleEvent.findFirst({
      where: lifecycleWhere(scope, lookbackRange),
      select: { id: true },
    }),
    deps.prisma.webhookRequestLog.findFirst({
      where: webhookWhere(scope, lookbackRange),
      select: { id: true },
    }),
    deps.prisma.synthflowRequestLog.findFirst({
      where: synthflowRequestWhere(scope, lookbackRange),
      select: { id: true },
    }),
    deps.prisma.synthflowOutboundResultLog.findFirst({
      where: synthflowOutboundWhere(scope, lookbackRange),
      select: { id: true },
    }),
    deps.prisma.inboundContactIndex.findFirst({
      where: inboundIndexWhere(scope),
      select: { id: true },
    }),
  ]);

  return {
    scope,
    clientName: clientConfig?.clientName ?? null,
    contacts,
    lifecycleLookback,
    lifecycleToday,
    synthflowInbound,
    synthflowOutbound,
    lastWebhookSuccessAt: lastWebhook?.receivedAt ?? null,
    hasLifecycleRows: Boolean(lifecycleAny),
    hasSynthflowInbound: Boolean(synthflowInAny),
    hasSynthflowOutbound: Boolean(synthflowOutAny),
    hasWebhookSuccess: Boolean(webhookAny),
    hasContacts: Boolean(contactAny),
  };
}

export function hasRelevantDashboardData(data: ActionDashboardRawData): boolean {
  return (
    data.hasContacts ||
    data.hasLifecycleRows ||
    data.hasWebhookSuccess ||
    data.hasSynthflowInbound ||
    data.hasSynthflowOutbound
  );
}

/**
 * Today's action dashboard for an agent subaccount (DB read model).
 */
export async function getActionDashboardToday(
  params: ActionDashboardTodayParams,
  deps: ActionDashboardServiceDeps = defaultDeps
): Promise<ActionDashboardTodayResponse> {
  const data = await loadActionDashboardRawData(params, deps);

  if (!hasRelevantDashboardData(data)) {
    const baseWarnings = [
      "No SA360 records found for this clientAccountId/locationId scope.",
    ];
    if (deps.nodeEnv === "development") {
      const seeded = getSeededActionDashboardToday({
        clientAccountId: params.clientAccountId,
        locationId: params.locationId,
        agentDisplayName: params.agentDisplayName,
      });
      return {
        ...seeded,
        setupWarnings: [
          ...baseWarnings,
          "Using seeded action-dashboard fallback in development (no database rows).",
          ...seeded.setupWarnings,
        ],
      };
    }
    const warnings = [...baseWarnings];
    if (!data.scope.subaccountIdGhl) {
      warnings.push("locationId not provided — showing client-level data across subaccounts.");
    }
    return emptyActionDashboardResponse(data.scope, warnings);
  }

  return buildActionDashboardFromData(data);
}
