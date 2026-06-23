import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function listActiveCampaignRoutingRules(
  masterClientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.findMany({
    where: {
      masterClientAccountId,
      active: true,
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
}

export async function listCampaignRoutingRules(
  opts: {
    masterClientAccountId?: string;
    clientAccountId?: string;
    destinationSubaccountIdGhl?: string;
    readinessStatus?: string;
    active?: boolean;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.CampaignRoutingRuleWhereInput = {};
  if (opts.masterClientAccountId?.trim()) {
    where.masterClientAccountId = opts.masterClientAccountId.trim();
  }
  if (opts.clientAccountId?.trim()) {
    where.clientAccountId = opts.clientAccountId.trim();
  }
  if (opts.destinationSubaccountIdGhl?.trim()) {
    where.destinationSubaccountIdGhl = opts.destinationSubaccountIdGhl.trim();
  }
  if (opts.readinessStatus?.trim()) {
    where.readinessStatus = opts.readinessStatus.trim();
  }
  if (opts.active !== undefined) {
    where.active = opts.active;
  }
  return db.campaignRoutingRule.findMany({
    where,
    orderBy: [{ masterClientAccountId: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
  });
}

export async function findCampaignRoutingRuleById(id: string, db: PrismaClient = prisma) {
  return db.campaignRoutingRule.findUnique({ where: { id } });
}

export async function updateCampaignRoutingRuleDeliveryConfig(
  id: string,
  data: Prisma.CampaignRoutingRuleUpdateInput,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.update({ where: { id }, data });
}

export async function createCampaignRoutingRule(
  data: Prisma.CampaignRoutingRuleCreateInput,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.create({ data });
}

export async function updateCampaignRoutingRule(
  id: string,
  data: Prisma.CampaignRoutingRuleUpdateInput,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.update({ where: { id }, data });
}

export async function countActiveRoutingRulesForClient(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.count({
    where: { clientAccountId: clientAccountId.trim(), active: true },
  });
}

export async function countRoutingRulesForClient(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.count({
    where: { clientAccountId: clientAccountId.trim() },
  });
}

export async function deleteCampaignRoutingRuleById(id: string, db: PrismaClient = prisma) {
  return db.campaignRoutingRule.delete({ where: { id: id.trim() } });
}

export async function deleteCampaignRoutingRulesForClient(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.campaignRoutingRule.deleteMany({
    where: { clientAccountId: clientAccountId.trim() },
  });
}

/** Distinct master lead sources with at least one active routing rule. */
export async function listDistinctRoutingMasterClientIds(db: PrismaClient = prisma) {
  const rows = await db.campaignRoutingRule.findMany({
    where: { active: true },
    distinct: ["masterClientAccountId"],
    select: { masterClientAccountId: true },
    orderBy: { masterClientAccountId: "asc" },
  });
  return rows.map((r) => r.masterClientAccountId);
}
