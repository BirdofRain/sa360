/**
 * Seed campaign routing rules from a JSON file (no hardcoded tenant or agent names).
 *
 * Idempotent: each rule is upserted by stable identity (master + client + matchType + match keys).
 * Safe to re-run when onboarding additional clients — existing rules update, new rules insert.
 *
 * Usage:
 *   ROUTING_RULES_SEED_PATH=./prisma/routing-rules.example.json pnpm exec tsx prisma/seed-routing-rules.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PrismaClient,
  type CampaignRoutingMatchType,
  type Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();

type SeedRule = {
  /** Optional label for seed logs only (not stored in DB). */
  seedKey?: string;
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
  destinationWorkflowIdGhl?: string;
  destinationPipelineIdGhl?: string;
  destinationPipelineStageIdGhl?: string;
  backupSheetEnabled?: boolean;
  backupSheetId?: string;
  defaultAssignedUserIdGhl?: string;
  deliveryEnabled?: boolean;
  shadowDeliveryEnabled?: boolean;
};

type SeedFile = {
  masterClientAccountId: string;
  rules: SeedRule[];
};

function trimOrNull(v?: string): string | null {
  const t = v?.trim();
  return t && t.length > 0 ? t : null;
}

/** Stable lookup key so re-seeding updates the same row instead of duplicating. */
function buildRuleLookupWhere(
  masterClientAccountId: string,
  rule: SeedRule
): Prisma.CampaignRoutingRuleWhereInput {
  return {
    masterClientAccountId,
    clientAccountId: rule.clientAccountId.trim(),
    matchType: rule.matchType,
    campaignId: trimOrNull(rule.campaignId),
    adsetId: trimOrNull(rule.adsetId),
    adId: trimOrNull(rule.adId),
    formId: trimOrNull(rule.formId),
    utmCampaign: trimOrNull(rule.utmCampaign),
    keywordPattern: trimOrNull(rule.keywordPattern),
  };
}

function buildRuleWriteData(
  masterClientAccountId: string,
  rule: SeedRule
): Prisma.CampaignRoutingRuleCreateInput {
  return {
    masterClientAccountId,
    clientAccountId: rule.clientAccountId.trim(),
    destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl?.trim() ?? "",
    clientDisplayName: rule.clientDisplayName,
    nicheKey: trimOrNull(rule.nicheKey) ?? undefined,
    productType: trimOrNull(rule.productType) ?? undefined,
    sourcePlatform: trimOrNull(rule.sourcePlatform) ?? undefined,
    sourceType: trimOrNull(rule.sourceType) ?? undefined,
    campaignId: trimOrNull(rule.campaignId) ?? undefined,
    campaignName: trimOrNull(rule.campaignName) ?? undefined,
    adsetId: trimOrNull(rule.adsetId) ?? undefined,
    adId: trimOrNull(rule.adId) ?? undefined,
    formId: trimOrNull(rule.formId) ?? undefined,
    utmCampaign: trimOrNull(rule.utmCampaign) ?? undefined,
    utmContent: trimOrNull(rule.utmContent) ?? undefined,
    masterDatasetId: trimOrNull(rule.masterDatasetId) ?? undefined,
    matchType: rule.matchType,
    keywordPattern: trimOrNull(rule.keywordPattern) ?? undefined,
    priority: rule.priority ?? 100,
    active: rule.active ?? true,
    effectiveStart: rule.effectiveStart ? new Date(rule.effectiveStart) : undefined,
    effectiveEnd: rule.effectiveEnd ? new Date(rule.effectiveEnd) : undefined,
    destinationWorkflowIdGhl: trimOrNull(rule.destinationWorkflowIdGhl) ?? undefined,
    destinationPipelineIdGhl: trimOrNull(rule.destinationPipelineIdGhl) ?? undefined,
    destinationPipelineStageIdGhl: trimOrNull(rule.destinationPipelineStageIdGhl) ?? undefined,
    backupSheetEnabled: rule.backupSheetEnabled ?? false,
    backupSheetId: trimOrNull(rule.backupSheetId) ?? undefined,
    defaultAssignedUserIdGhl: trimOrNull(rule.defaultAssignedUserIdGhl) ?? undefined,
    deliveryEnabled: rule.deliveryEnabled ?? false,
    shadowDeliveryEnabled: rule.shadowDeliveryEnabled ?? true,
  };
}

async function upsertCampaignRoutingRule(
  masterClientAccountId: string,
  rule: SeedRule
): Promise<"created" | "updated"> {
  const where = buildRuleLookupWhere(masterClientAccountId, rule);
  const data = buildRuleWriteData(masterClientAccountId, rule);
  const existing = await prisma.campaignRoutingRule.findFirst({ where });

  if (existing) {
    await prisma.campaignRoutingRule.update({
      where: { id: existing.id },
      data,
    });
    return "updated";
  }

  await prisma.campaignRoutingRule.create({ data });
  return "created";
}

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
  let created = 0;
  let updated = 0;

  for (const rule of seed.rules) {
    const result = await upsertCampaignRoutingRule(master, rule);
    if (result === "created") created += 1;
    else updated += 1;
    if (rule.seedKey) {
      console.log(`  ${result}: ${rule.seedKey}`);
    }
  }

  console.log(
    `Routing seed for ${master}: ${created} created, ${updated} updated (${seed.rules.length} total in file)`
  );
}

main()
  .catch((err) => {
    console.error("Routing seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
