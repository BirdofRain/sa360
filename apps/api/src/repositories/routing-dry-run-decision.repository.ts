import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createRoutingDryRunDecision(
  data: Prisma.RoutingDryRunDecisionCreateInput,
  db: PrismaClient = prisma
) {
  return db.routingDryRunDecision.create({ data });
}

export type RoutingDryRunReviewQueue =
  | "unreviewed_only"
  | "mismatches"
  | "needs_mapping"
  | "matched_no_plan"
  | "matched_needs_config_plan";

function applyReviewQueueFilter(
  where: Prisma.RoutingDryRunDecisionWhereInput,
  reviewQueue: RoutingDryRunReviewQueue | undefined
): void {
  if (!reviewQueue) return;
  switch (reviewQueue) {
    case "unreviewed_only":
      where.OR = [{ validationStatus: null }, { validationStatus: "unreviewed" }];
      break;
    case "mismatches":
      where.validationStatus = "mismatch";
      break;
    case "needs_mapping":
      where.validationStatus = "needs_mapping";
      break;
    case "matched_no_plan":
      where.matched = true;
      where.deliveryPlan = null;
      break;
    case "matched_needs_config_plan":
      where.matched = true;
      where.deliveryPlan = { status: "needs_config" };
      break;
  }
}

export function buildRoutingDryRunDecisionWhere(opts: {
  masterClientAccountId: string;
  matched?: boolean;
  validationStatus?: string;
  destinationClientAccountId?: string;
  reviewQueue?: RoutingDryRunReviewQueue;
  createdAfter?: Date;
  createdBefore?: Date;
}): Prisma.RoutingDryRunDecisionWhereInput {
  const where: Prisma.RoutingDryRunDecisionWhereInput = {
    masterClientAccountId: opts.masterClientAccountId.trim(),
  };
  if (opts.matched !== undefined) {
    where.matched = opts.matched;
  }
  if (opts.destinationClientAccountId?.trim()) {
    where.destinationClientAccountId = opts.destinationClientAccountId.trim();
  }
  if (opts.createdAfter || opts.createdBefore) {
    where.createdAt = {};
    if (opts.createdAfter) where.createdAt.gte = opts.createdAfter;
    if (opts.createdBefore) where.createdAt.lte = opts.createdBefore;
  }
  if (opts.reviewQueue) {
    applyReviewQueueFilter(where, opts.reviewQueue);
  } else if (opts.validationStatus !== undefined) {
    if (opts.validationStatus === "unreviewed") {
      where.OR = [{ validationStatus: null }, { validationStatus: "unreviewed" }];
    } else {
      where.validationStatus = opts.validationStatus;
    }
  }
  return where;
}

export async function listRecentRoutingDryRunDecisions(
  opts: {
    masterClientAccountId: string;
    limit?: number;
    matched?: boolean;
    validationStatus?: string;
    destinationClientAccountId?: string;
    reviewQueue?: RoutingDryRunReviewQueue;
    createdAfter?: Date;
    createdBefore?: Date;
  },
  db: PrismaClient = prisma
) {
  const where = buildRoutingDryRunDecisionWhere(opts);
  return db.routingDryRunDecision.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
}

export async function aggregateRoutingDryRunStats(
  opts: {
    masterClientAccountId: string;
    destinationClientAccountId?: string;
    createdAfter?: Date;
    createdBefore?: Date;
  },
  db: PrismaClient = prisma
) {
  const decisionWhere = buildRoutingDryRunDecisionWhere({
    masterClientAccountId: opts.masterClientAccountId,
    destinationClientAccountId: opts.destinationClientAccountId,
    createdAfter: opts.createdAfter,
    createdBefore: opts.createdBefore,
  });

  const planWhere: Prisma.LeadDeliveryPlanWhereInput = {
    masterClientAccountId: opts.masterClientAccountId.trim(),
  };
  if (opts.destinationClientAccountId?.trim()) {
    planWhere.destinationClientAccountId = opts.destinationClientAccountId.trim();
  }
  if (opts.createdAfter || opts.createdBefore) {
    planWhere.generatedAt = {};
    if (opts.createdAfter) planWhere.generatedAt.gte = opts.createdAfter;
    if (opts.createdBefore) planWhere.generatedAt.lte = opts.createdBefore;
  }

  const [
    totalDecisions,
    matched,
    reviewRequired,
    unreviewed,
    validationGroups,
    generatedPlans,
    needsConfigPlans,
  ] = await Promise.all([
    db.routingDryRunDecision.count({ where: decisionWhere }),
    db.routingDryRunDecision.count({ where: { ...decisionWhere, matched: true } }),
    db.routingDryRunDecision.count({ where: { ...decisionWhere, matched: false } }),
    db.routingDryRunDecision.count({
      where: {
        ...decisionWhere,
        OR: [{ validationStatus: null }, { validationStatus: "unreviewed" }],
      },
    }),
    db.routingDryRunDecision.groupBy({
      by: ["validationStatus"],
      where: decisionWhere,
      _count: { _all: true },
    }),
    db.leadDeliveryPlan.count({
      where: { ...planWhere, routingDryRunDecisionId: { not: null } },
    }),
    db.leadDeliveryPlan.count({
      where: { ...planWhere, status: "needs_config" },
    }),
  ]);

  return {
    totalDecisions,
    matched,
    reviewRequired,
    unreviewed,
    generatedPlans,
    needsConfigPlans,
    validationGroups: validationGroups.map((g) => ({
      validationStatus: g.validationStatus,
      _count: g._count._all,
    })),
  };
}

export async function findRoutingDryRunDecisionById(id: string, db: PrismaClient = prisma) {
  return db.routingDryRunDecision.findUnique({ where: { id } });
}

export async function updateRoutingDryRunDecisionValidation(
  id: string,
  data: Prisma.RoutingDryRunDecisionUpdateInput,
  db: PrismaClient = prisma
) {
  return db.routingDryRunDecision.update({ where: { id }, data });
}
