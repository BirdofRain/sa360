import type { PrismaClient } from "@prisma/client";
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
