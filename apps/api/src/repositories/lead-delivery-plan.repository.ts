import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function findDeliveryPlanById(id: string, db: PrismaClient = prisma) {
  return db.leadDeliveryPlan.findUnique({
    where: { id },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function findDeliveryPlanByRoutingDecisionId(
  routingDryRunDecisionId: string,
  db: PrismaClient = prisma
) {
  return db.leadDeliveryPlan.findUnique({
    where: { routingDryRunDecisionId },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function listDeliveryPlans(
  opts: {
    masterClientAccountId: string;
    destinationClientAccountId?: string;
    status?: string;
    limit?: number;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.LeadDeliveryPlanWhereInput = {
    masterClientAccountId: opts.masterClientAccountId,
  };
  if (opts.destinationClientAccountId?.trim()) {
    where.destinationClientAccountId = opts.destinationClientAccountId.trim();
  }
  if (opts.status?.trim()) {
    where.status = opts.status.trim();
  }
  return db.leadDeliveryPlan.findMany({
    where,
    orderBy: { generatedAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function findDeliveryPlanSummariesByDecisionIds(
  decisionIds: string[],
  db: PrismaClient = prisma
) {
  if (decisionIds.length === 0) return [];
  return db.leadDeliveryPlan.findMany({
    where: { routingDryRunDecisionId: { in: decisionIds } },
    select: {
      id: true,
      routingDryRunDecisionId: true,
      status: true,
      deliveryMode: true,
      generatedAt: true,
    },
  });
}

export async function replaceDeliveryPlanForDecision(
  routingDryRunDecisionId: string,
  planData: Prisma.LeadDeliveryPlanCreateInput,
  db: PrismaClient = prisma
) {
  return db.$transaction(async (tx) => {
    await tx.leadDeliveryPlan.deleteMany({ where: { routingDryRunDecisionId } });
    return tx.leadDeliveryPlan.create({
      data: planData,
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
  });
}

export async function updateDeliveryPlanStatus(
  id: string,
  status: string,
  db: PrismaClient = prisma
) {
  return db.leadDeliveryPlan.update({
    where: { id },
    data: { status },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
}
