/**
 * Seed campaign routing rules from a JSON file (no hardcoded tenant or agent names).
 *
 * Usage:
 *   ROUTING_RULES_SEED_PATH=./prisma/routing-rules.example.json pnpm exec tsx prisma/seed-routing-rules.ts
 *
 * Copy `routing-rules.example.json`, replace placeholders with your master/client IDs and Meta IDs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, type CampaignRoutingMatchType } from "@prisma/client";

const prisma = new PrismaClient();

type SeedRule = {
  clientAccountId: string;
  destinationSubaccountIdGhl?: string;
  clientDisplayName?: string;
  nicheKey?: string;
  productType?: string;
  sourcePlatform?: string;
  sourceType?: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adId?: string;
  formId?: string;
  utmCampaign?: string;
  utmContent?: string;
  masterDatasetId?: string;
  matchType: CampaignRoutingMatchType;
  keywordPattern?: string;
  priority?: number;
  active?: boolean;
  effectiveStart?: string;
  effectiveEnd?: string;
};

type SeedFile = {
  masterClientAccountId: string;
  rules: SeedRule[];
};

function loadSeed(): SeedFile {
  const path = process.env.ROUTING_RULES_SEED_PATH?.trim();
  if (!path) {
    throw new Error("Set ROUTING_RULES_SEED_PATH to a JSON file (see prisma/routing-rules.example.json)");
  }
  const raw = readFileSync(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as SeedFile;
  if (!parsed.masterClientAccountId?.trim()) {
    throw new Error("Seed file must include masterClientAccountId");
  }
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error("Seed file must include a non-empty rules array");
  }
  return parsed;
}

async function main() {
  const seed = loadSeed();
  const master = seed.masterClientAccountId.trim();

  for (const rule of seed.rules) {
    await prisma.campaignRoutingRule.create({
      data: {
        masterClientAccountId: master,
        clientAccountId: rule.clientAccountId,
        destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl?.trim() ?? "",
        clientDisplayName: rule.clientDisplayName,
        nicheKey: rule.nicheKey,
        productType: rule.productType,
        sourcePlatform: rule.sourcePlatform,
        sourceType: rule.sourceType,
        campaignId: rule.campaignId,
        campaignName: rule.campaignName,
        adsetId: rule.adsetId,
        adId: rule.adId,
        formId: rule.formId,
        utmCampaign: rule.utmCampaign,
        utmContent: rule.utmContent,
        masterDatasetId: rule.masterDatasetId,
        matchType: rule.matchType,
        keywordPattern: rule.keywordPattern,
        priority: rule.priority ?? 100,
        active: rule.active ?? true,
        effectiveStart: rule.effectiveStart ? new Date(rule.effectiveStart) : undefined,
        effectiveEnd: rule.effectiveEnd ? new Date(rule.effectiveEnd) : undefined,
      },
    });
  }

  console.log(`Seeded ${seed.rules.length} routing rule(s) for master ${master}`);
}

main()
  .catch((err) => {
    console.error("Routing seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
