import type { CampaignRoutingRule, Prisma, PrismaClient } from "@prisma/client";
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

export type ActiveRoutingRulePage = {
  items: CampaignRoutingRule[];
  nextCursor: string | null;
};

function isMissingCursor(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2025";
}

/**
 * Active routing rules for every client. Inactive rules are excluded.
 * This is a read of rule identity, not a delivery or mutation path.
 */
export async function listActiveCampaignRoutingRulesPage(
  input: { limit: number; cursor?: string },
  db: PrismaClient = prisma
): Promise<ActiveRoutingRulePage | { error: "invalid_cursor" }> {
  const take = input.limit;
  const cursor = input.cursor?.trim() || undefined;
  if (cursor) {
    const anchor = await db.campaignRoutingRule.findUnique({ where: { id: cursor }, select: { id: true } });
    if (!anchor) return { error: "invalid_cursor" };
  }
  try {
    const rows = await db.campaignRoutingRule.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  } catch (err) {
    if (isMissingCursor(err)) return { error: "invalid_cursor" };
    throw err;
  }
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
  db: PrismaClient | Prisma.TransactionClient = prisma
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
