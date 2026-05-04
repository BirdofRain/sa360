import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

function utcStartOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export type AdminMetricsSummary = {
  webhookRequestsTotal: number;
  webhookRequestsToday: number;
  webhookFailures: number;
  webhookValidationFailures: number;
  webhookSkipped: number;
  webhookQueued: number;
  synthflowRequestsTotal: number;
  synthflowRequestsToday: number;
  synthflowKnownCallerCount: number;
  synthflowUnknownCallerCount: number;
  synthflowLookupErrors: number;
  synthflowGuardrails: number;
  averageWebhookDurationMs: number | null;
  averageSynthflowDurationMs: number | null;
  latestWebhookAt: string | null;
  latestSynthflowAt: string | null;
};

/**
 * Summary metrics. Main counts/averages use `[from, to]` on `receivedAt`.
 * `*Today` counts use UTC midnight → now for the calendar day containing `to`.
 */
export async function getAdminMetricsSummary(from: Date, to: Date): Promise<AdminMetricsSummary> {
  const webhookRange: Prisma.WebhookRequestLogWhereInput = {
    source: "ghl_lifecycle",
    receivedAt: { gte: from, lte: to },
  };

  const synthRange: Prisma.SynthflowRequestLogWhereInput = {
    receivedAt: { gte: from, lte: to },
  };

  const now = new Date();
  const todayStart = utcStartOfDay(now);

  const webhookToday: Prisma.WebhookRequestLogWhereInput = {
    source: "ghl_lifecycle",
    receivedAt: { gte: todayStart, lte: now },
  };

  const synthToday: Prisma.SynthflowRequestLogWhereInput = {
    receivedAt: { gte: todayStart, lte: now },
  };

  const [
    webhookRequestsTotal,
    webhookRequestsToday,
    webhookFailures,
    webhookValidationFailures,
    webhookSkipped,
    webhookQueued,
    synthflowRequestsTotal,
    synthflowRequestsToday,
    synthflowKnownCallerCount,
    synthflowUnknownCallerCount,
    synthflowLookupErrors,
    synthflowGuardrails,
    whAvg,
    sfAvg,
    whLatest,
    sfLatest,
  ] = await Promise.all([
    prisma.webhookRequestLog.count({ where: webhookRange }),
    prisma.webhookRequestLog.count({ where: webhookToday }),
    prisma.webhookRequestLog.count({
      where: {
        ...webhookRange,
        OR: [
          { processingStatus: "failed" },
          { httpStatus: { gte: 500 } },
        ],
      },
    }),
    prisma.webhookRequestLog.count({
      where: { ...webhookRange, processingStatus: "validation_failed" },
    }),
    prisma.webhookRequestLog.count({
      where: { ...webhookRange, processingStatus: "skipped" },
    }),
    prisma.webhookRequestLog.count({
      where: { ...webhookRange, processingStatus: "queued" },
    }),
    prisma.synthflowRequestLog.count({ where: synthRange }),
    prisma.synthflowRequestLog.count({ where: synthToday }),
    prisma.synthflowRequestLog.count({
      where: { ...synthRange, knownCaller: "true" },
    }),
    prisma.synthflowRequestLog.count({
      where: { ...synthRange, knownCaller: "false" },
    }),
    prisma.synthflowRequestLog.count({
      where: {
        ...synthRange,
        OR: [
          { processingStatus: "lookup_error" },
          { lookupStatus: "lookup_error" },
        ],
      },
    }),
    prisma.synthflowRequestLog.count({
      where: {
        ...synthRange,
        processingStatus: { in: ["guardrail", "validation_failed"] },
      },
    }),
    prisma.webhookRequestLog.aggregate({
      where: {
        ...webhookRange,
        durationMs: { not: null },
      },
      _avg: { durationMs: true },
    }),
    prisma.synthflowRequestLog.aggregate({
      where: {
        ...synthRange,
        durationMs: { not: null },
      },
      _avg: { durationMs: true },
    }),
    prisma.webhookRequestLog.findFirst({
      where: webhookRange,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { receivedAt: true },
    }),
    prisma.synthflowRequestLog.findFirst({
      where: synthRange,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { receivedAt: true },
    }),
  ]);

  return {
    webhookRequestsTotal,
    webhookRequestsToday,
    webhookFailures,
    webhookValidationFailures,
    webhookSkipped,
    webhookQueued,
    synthflowRequestsTotal,
    synthflowRequestsToday,
    synthflowKnownCallerCount,
    synthflowUnknownCallerCount,
    synthflowLookupErrors,
    synthflowGuardrails,
    averageWebhookDurationMs:
      whAvg._avg.durationMs != null ? Math.round(whAvg._avg.durationMs) : null,
    averageSynthflowDurationMs:
      sfAvg._avg.durationMs != null ? Math.round(sfAvg._avg.durationMs) : null,
    latestWebhookAt: whLatest?.receivedAt?.toISOString() ?? null,
    latestSynthflowAt: sfLatest?.receivedAt?.toISOString() ?? null,
  };
}
