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
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.RoutingDryRunDecisionWhereInput = {
    masterClientAccountId: opts.masterClientAccountId,
  };
  if (opts.matched !== undefined) {
    where.matched = opts.matched;
  }
  return db.routingDryRunDecision.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
}
