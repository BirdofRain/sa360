import type { Prisma } from "@prisma/client";

export type ActionDashboardScope = {
  clientAccountId: string;
  /** Resolved GHL location / subaccount id, or undefined for client-wide */
  subaccountIdGhl?: string;
  agentDisplayName?: string;
  locationIdForResponse: string;
  todayStart: Date;
  now: Date;
  /** Lifecycle / voice activity lookback for ranking */
  lookbackStart: Date;
};

export function utcStartOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function resolveActionDashboardScope(params: {
  clientAccountId: string;
  locationId?: string;
  agentDisplayName?: string;
  now?: Date;
}): ActionDashboardScope {
  const now = params.now ?? new Date();
  const locationTrim = params.locationId?.trim();
  const subaccountIdGhl = locationTrim || undefined;

  return {
    clientAccountId: params.clientAccountId.trim(),
    subaccountIdGhl,
    agentDisplayName: params.agentDisplayName?.trim() || undefined,
    locationIdForResponse: subaccountIdGhl ?? "",
    todayStart: utcStartOfDay(now),
    now,
    lookbackStart: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
  };
}

export function inboundIndexWhere(scope: ActionDashboardScope): Prisma.InboundContactIndexWhereInput {
  const w: Prisma.InboundContactIndexWhereInput = {
    clientAccountId: scope.clientAccountId,
  };
  if (scope.subaccountIdGhl !== undefined) {
    w.subaccountIdGhl = scope.subaccountIdGhl;
  }
  return w;
}

export function lifecycleWhere(
  scope: ActionDashboardScope,
  receivedAt?: { gte?: Date; lte?: Date }
): Prisma.LifecycleEventWhereInput {
  const w: Prisma.LifecycleEventWhereInput = {
    clientAccountId: scope.clientAccountId,
  };
  if (scope.subaccountIdGhl !== undefined) {
    w.subaccountIdGhl = scope.subaccountIdGhl;
  }
  if (receivedAt) w.receivedAt = receivedAt;
  return w;
}

export function webhookWhere(
  scope: ActionDashboardScope,
  receivedAt?: { gte?: Date; lte?: Date }
): Prisma.WebhookRequestLogWhereInput {
  const w: Prisma.WebhookRequestLogWhereInput = {
    source: "ghl_lifecycle",
    clientAccountId: scope.clientAccountId,
  };
  if (scope.subaccountIdGhl !== undefined) {
    w.subaccountIdGhl = scope.subaccountIdGhl;
  }
  if (receivedAt) w.receivedAt = receivedAt;
  return w;
}

export function synthflowRequestWhere(
  scope: ActionDashboardScope,
  receivedAt?: { gte?: Date; lte?: Date }
): Prisma.SynthflowRequestLogWhereInput {
  const w: Prisma.SynthflowRequestLogWhereInput = {
    clientAccountId: scope.clientAccountId,
  };
  if (scope.subaccountIdGhl !== undefined) {
    w.subaccountIdGhl = scope.subaccountIdGhl;
  }
  if (receivedAt) w.receivedAt = receivedAt;
  return w;
}

export function synthflowOutboundWhere(
  scope: ActionDashboardScope,
  receivedAt?: { gte?: Date; lte?: Date }
): Prisma.SynthflowOutboundResultLogWhereInput {
  const w: Prisma.SynthflowOutboundResultLogWhereInput = {
    clientAccountId: scope.clientAccountId,
  };
  if (scope.subaccountIdGhl !== undefined) {
    w.subaccountIdGhl = scope.subaccountIdGhl;
  }
  if (receivedAt) w.receivedAt = receivedAt;
  return w;
}

/** Webhook rows treated as successful ingest (not hard failures). */
export const WEBHOOK_FAILURE_STATUSES = [
  "failed",
  "validation_failed",
  "unauthorized",
] as const;

export function webhookSuccessWhere(scope: ActionDashboardScope): Prisma.WebhookRequestLogWhereInput {
  return {
    ...webhookWhere(scope),
    NOT: {
      OR: [
        { processingStatus: { in: [...WEBHOOK_FAILURE_STATUSES] } },
        { httpStatus: { gte: 500 } },
      ],
    },
  };
}
