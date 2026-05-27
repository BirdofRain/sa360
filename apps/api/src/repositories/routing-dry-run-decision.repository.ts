import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createRoutingDryRunDecision(
  data: Prisma.RoutingDryRunDecisionCreateInput,
  db: PrismaClient = prisma
) {
  return db.routingDryRunDecision.create({ data });
}

export async function listRecentRoutingDryRunDecisions(
  opts: {
    masterClientAccountId: string;
    limit?: number;
    matched?: boolean;
    validationStatus?: string;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.RoutingDryRunDecisionWhereInput = {
    masterClientAccountId: opts.masterClientAccountId,
  };
  if (opts.matched !== undefined) {
    where.matched = opts.matched;
  }
  if (opts.validationStatus !== undefined) {
    if (opts.validationStatus === "unreviewed") {
      where.OR = [{ validationStatus: null }, { validationStatus: "unreviewed" }];
    } else {
      where.validationStatus = opts.validationStatus;
    }
  }
  return db.routingDryRunDecision.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
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
