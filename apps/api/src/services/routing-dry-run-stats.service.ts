import type { Prisma } from "@prisma/client";
import { aggregateRoutingDryRunStats } from "../repositories/routing-dry-run-decision.repository.js";

export type RoutingDryRunStatsResult = {
  masterClientAccountId: string;
  destinationClientAccountId: string | null;
  createdAfter: string | null;
  createdBefore: string | null;
  totalDecisions: number;
  matched: number;
  reviewRequired: number;
  generatedPlans: number;
  needsConfigPlans: number;
  validatedMatchedLegacy: number;
  mismatches: number;
  needsMapping: number;
  ignoredTest: number;
  legacyUnknown: number;
  unreviewed: number;
  matchRate: number | null;
  validationCoverage: number | null;
};

export function countValidationStatus(
  groups: Array<{ validationStatus: string | null; _count: number }>,
  status: string
): number {
  const row = groups.find((g) => g.validationStatus === status);
  return row?._count ?? 0;
}

export function finalizeRoutingDryRunStats(
  opts: {
    masterClientAccountId: string;
    destinationClientAccountId?: string;
    includeCleanup?: boolean;
    cleanupStatus?: string;
    createdAfter?: Date;
    createdBefore?: Date;
  },
  raw: Awaited<ReturnType<typeof aggregateRoutingDryRunStats>>
): RoutingDryRunStatsResult {
  const total = raw.totalDecisions;
  const matched = raw.matched;
  const reviewed = total - raw.unreviewed;

  return {
    masterClientAccountId: opts.masterClientAccountId,
    destinationClientAccountId: opts.destinationClientAccountId?.trim() || null,
    createdAfter: opts.createdAfter?.toISOString() ?? null,
    createdBefore: opts.createdBefore?.toISOString() ?? null,
    totalDecisions: total,
    matched,
    reviewRequired: raw.reviewRequired,
    generatedPlans: raw.generatedPlans,
    needsConfigPlans: raw.needsConfigPlans,
    validatedMatchedLegacy: countValidationStatus(raw.validationGroups, "matched_legacy"),
    mismatches: countValidationStatus(raw.validationGroups, "mismatch"),
    needsMapping: countValidationStatus(raw.validationGroups, "needs_mapping"),
    ignoredTest: countValidationStatus(raw.validationGroups, "ignored_test"),
    legacyUnknown: countValidationStatus(raw.validationGroups, "legacy_unknown"),
    unreviewed: raw.unreviewed,
    matchRate: total > 0 ? Math.round((matched / total) * 1000) / 1000 : null,
    validationCoverage: total > 0 ? Math.round((reviewed / total) * 1000) / 1000 : null,
  };
}

export async function getRoutingDryRunStats(opts: {
  masterClientAccountId: string;
  destinationClientAccountId?: string;
  includeCleanup?: boolean;
  cleanupStatus?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}): Promise<RoutingDryRunStatsResult> {
  const raw = await aggregateRoutingDryRunStats(opts);
  return finalizeRoutingDryRunStats(opts, raw);
}

export function buildRoutingDryRunStatsWhere(opts: {
  masterClientAccountId: string;
  destinationClientAccountId?: string;
  includeCleanup?: boolean;
  cleanupStatus?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}): Prisma.RoutingDryRunDecisionWhereInput {
  const where: Prisma.RoutingDryRunDecisionWhereInput = {
    masterClientAccountId: opts.masterClientAccountId.trim(),
  };
  if (opts.destinationClientAccountId?.trim()) {
    where.destinationClientAccountId = opts.destinationClientAccountId.trim();
  }
  if (opts.cleanupStatus?.trim()) {
    where.cleanupStatus = opts.cleanupStatus.trim();
  } else if (!opts.includeCleanup) {
    where.cleanupStatus = null;
  }
  if (opts.createdAfter || opts.createdBefore) {
    where.createdAt = {};
    if (opts.createdAfter) where.createdAt.gte = opts.createdAfter;
    if (opts.createdBefore) where.createdAt.lte = opts.createdBefore;
  }
  return where;
}
