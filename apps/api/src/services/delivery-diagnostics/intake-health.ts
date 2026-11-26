/**
 * Source intake counts from SA360's own tables.
 *
 * These counts say what SA360 received and what it did with it. They are not
 * independently verified source generation totals: LeadCapture, Zapier, and
 * Meta never report their own totals into SA360.
 */

import type { Prisma } from "@prisma/client";

import type { DiagnosticsDb } from "./read-only.js";
import { MAX_DIAGNOSTIC_WINDOW_MS, type DiagnosticWindow } from "./window.js";

const MATCHED = new Set(["routing_matched", "approved", "delivered", "delivery_failed"]);
const PRE_ROUTING = new Set(["received", "normalized"]);

export type IntakeSourceRow = {
  sourceProvider: string;
  sourceSystem: string;
  received: number;
  byStatus: Record<string, number>;
  lastReceivedAtInWindow: string | null;
};

export type IntakeHealth = {
  scope: "window";
  sources: IntakeSourceRow[];
  totals: {
    received: number;
    accepted: number;
    rejectedEvents: number;
    duplicates: number;
    matched: number;
    unmatched: number;
    needsReview: number;
    deliveryFailed: number;
    preRouting: number;
  };
  cleanupMarkedExcluded: number;
  webhookRequests: {
    total: number;
    byHttpClass: Record<string, number>;
    bySource: Array<{ source: string; total: number; non2xx: number; byProcessingStatus: Record<string, number> }>;
    campaignFilterApplies: false;
  };
  lastActivityBySource: Array<{ sourceProvider: string; sourceSystem: string; lastReceivedAt: string }>;
  lastActivityScope: "last_7_days";
  campaignFilter: { applied: boolean; sourceCampaignId: string | null };
};

function httpClass(status: number | null): string {
  if (status == null) return "none";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500) return "5xx";
  return "other";
}

export async function loadIntakeHealth(
  db: DiagnosticsDb,
  input: { window: DiagnosticWindow; clientAccountId: string | null; campaignId: string | null }
): Promise<IntakeHealth> {
  const { window } = input;
  const eventWhere: Prisma.SourceLeadEventWhereInput = {
    receivedAt: { gte: window.from, lt: window.to },
    cleanupStatus: null,
    ...(input.clientAccountId ? { clientAccountIdResolved: input.clientAccountId } : {}),
    ...(input.campaignId ? { sourceCampaignId: input.campaignId } : {}),
  };
  const markedWhere: Prisma.SourceLeadEventWhereInput = {
    ...eventWhere,
    cleanupStatus: { not: null },
  };

  const groups = await db.sourceLeadEvent.groupBy({
    by: ["sourceProvider", "sourceSystem", "status"],
    where: eventWhere,
    _count: { _all: true },
    _max: { receivedAt: true },
  });
  const cleanupMarkedExcluded = await db.sourceLeadEvent.count({ where: markedWhere });

  const activityFrom = new Date(window.to.getTime() - MAX_DIAGNOSTIC_WINDOW_MS);
  const activity = await db.sourceLeadEvent.groupBy({
    by: ["sourceProvider", "sourceSystem"],
    where: {
      receivedAt: { gte: activityFrom, lt: window.to },
      cleanupStatus: null,
      ...(input.clientAccountId ? { clientAccountIdResolved: input.clientAccountId } : {}),
      ...(input.campaignId ? { sourceCampaignId: input.campaignId } : {}),
    },
    _max: { receivedAt: true },
  });

  const bySource = new Map<string, IntakeSourceRow>();
  const totals = {
    received: 0,
    accepted: 0,
    rejectedEvents: 0,
    duplicates: 0,
    matched: 0,
    unmatched: 0,
    needsReview: 0,
    deliveryFailed: 0,
    preRouting: 0,
  };
  for (const group of groups) {
    const key = `${group.sourceProvider}|${group.sourceSystem}`;
    const row =
      bySource.get(key) ??
      ({
        sourceProvider: group.sourceProvider,
        sourceSystem: group.sourceSystem,
        received: 0,
        byStatus: {},
        lastReceivedAtInWindow: null,
      } satisfies IntakeSourceRow);
    const count = group._count._all;
    row.received += count;
    row.byStatus[group.status] = (row.byStatus[group.status] ?? 0) + count;
    const last = group._max.receivedAt?.toISOString() ?? null;
    if (last && (!row.lastReceivedAtInWindow || last > row.lastReceivedAtInWindow)) row.lastReceivedAtInWindow = last;
    bySource.set(key, row);

    totals.received += count;
    if (group.status !== "rejected") totals.accepted += count;
    if (group.status === "rejected") totals.rejectedEvents += count;
    if (group.status === "duplicate_blocked") totals.duplicates += count;
    if (MATCHED.has(group.status)) totals.matched += count;
    if (group.status === "routing_unmatched") totals.unmatched += count;
    if (group.status === "needs_review") totals.needsReview += count;
    if (group.status === "delivery_failed") totals.deliveryFailed += count;
    if (PRE_ROUTING.has(group.status)) totals.preRouting += count;
  }

  const hooks = await db.webhookRequestLog.groupBy({
    by: ["source", "processingStatus", "httpStatus"],
    where: {
      receivedAt: { gte: window.from, lt: window.to },
      ...(input.clientAccountId ? { clientAccountId: input.clientAccountId } : {}),
    },
    _count: { _all: true },
  });
  const byHttpClass: Record<string, number> = {};
  const hookSources = new Map<
    string,
    { source: string; total: number; non2xx: number; byProcessingStatus: Record<string, number> }
  >();
  let hookTotal = 0;
  for (const group of hooks) {
    const count = group._count._all;
    const klass = httpClass(group.httpStatus);
    hookTotal += count;
    byHttpClass[klass] = (byHttpClass[klass] ?? 0) + count;
    const entry = hookSources.get(group.source) ?? {
      source: group.source,
      total: 0,
      non2xx: 0,
      byProcessingStatus: {},
    };
    entry.total += count;
    if (klass !== "2xx") entry.non2xx += count;
    entry.byProcessingStatus[group.processingStatus] = (entry.byProcessingStatus[group.processingStatus] ?? 0) + count;
    hookSources.set(group.source, entry);
  }

  return {
    scope: "window",
    sources: [...bySource.values()].sort((a, b) => b.received - a.received),
    totals,
    cleanupMarkedExcluded,
    webhookRequests: {
      total: hookTotal,
      byHttpClass,
      bySource: [...hookSources.values()].sort((a, b) => b.total - a.total),
      campaignFilterApplies: false,
    },
    lastActivityBySource: activity
      .flatMap((row) =>
        row._max.receivedAt
          ? [
              {
                sourceProvider: row.sourceProvider,
                sourceSystem: row.sourceSystem,
                lastReceivedAt: row._max.receivedAt.toISOString(),
              },
            ]
          : []
      )
      .sort((a, b) => b.lastReceivedAt.localeCompare(a.lastReceivedAt)),
    lastActivityScope: "last_7_days",
    campaignFilter: { applied: input.campaignId != null, sourceCampaignId: input.campaignId },
  };
}
