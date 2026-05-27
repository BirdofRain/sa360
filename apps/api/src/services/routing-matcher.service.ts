import type { CampaignRoutingMatchType, CampaignRoutingRule } from "@prisma/client";
import {
  routingAttributionHaystack,
  type RoutingAttributionInput,
} from "../lib/routing-attribution-extract.js";

export type RoutingMatchConfidence = "high" | "medium" | "low" | "none";

export type RoutingMatchResult = {
  matched: boolean;
  confidence: RoutingMatchConfidence;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationSubaccountIdGhl?: string;
  reason: string;
  matchType?: CampaignRoutingMatchType;
};

const MATCH_TIER_ORDER: CampaignRoutingMatchType[] = [
  "campaign_id",
  "adset_id",
  "ad_id",
  "form_id_utm_campaign",
  "utm_campaign",
  "keyword_fallback",
];

const CONFIDENCE_BY_TIER: Record<CampaignRoutingMatchType, RoutingMatchConfidence> = {
  campaign_id: "high",
  adset_id: "high",
  ad_id: "high",
  form_id_utm_campaign: "high",
  utm_campaign: "medium",
  keyword_fallback: "low",
};

function normalizeId(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function isRuleEffective(rule: CampaignRoutingRule, now: Date): boolean {
  if (!rule.active) return false;
  if (rule.effectiveStart && rule.effectiveStart > now) return false;
  if (rule.effectiveEnd && rule.effectiveEnd < now) return false;
  return true;
}

/**
 * Optional rule scope (niche, product, platform, dataset).
 * When the rule sets a scope value but the lead omits that dimension, the scope is not applied
 * (inbound lead_created payloads often lack routing.niche_key / policy.product_type).
 * When the lead provides the dimension, it must match the rule (case-insensitive).
 */
function scopeDimensionMatches(
  ruleValue: string | null | undefined,
  leadValue: string | undefined
): boolean {
  const expected = normalizeId(ruleValue);
  if (!expected) return true;
  const actual = normalizeId(leadValue);
  if (!actual) return true;
  return actual.toLowerCase() === expected.toLowerCase();
}

function ruleScopeMatches(rule: CampaignRoutingRule, input: RoutingAttributionInput): boolean {
  return (
    scopeDimensionMatches(rule.nicheKey, input.nicheKey) &&
    scopeDimensionMatches(rule.productType, input.productType) &&
    scopeDimensionMatches(rule.sourcePlatform, input.sourcePlatform) &&
    scopeDimensionMatches(rule.sourceType, input.sourceType) &&
    scopeDimensionMatches(rule.masterDatasetId, input.masterDatasetId)
  );
}

export type RoutingMatcherRejectionReason =
  | "inactive"
  | "wrong_tier"
  | "tier_key_mismatch"
  | "scope_nicheKey"
  | "scope_productType"
  | "scope_sourcePlatform"
  | "scope_sourceType"
  | "scope_masterDatasetId";

export type RoutingMatcherDebugRejection = {
  ruleId: string;
  matchType: CampaignRoutingMatchType;
  reasons: RoutingMatcherRejectionReason[];
};

export type RoutingMatcherDebug = {
  extractedInput: RoutingAttributionInput;
  activeRuleCount: number;
  rejections: RoutingMatcherDebugRejection[];
};

function rejectionReasonsForRule(
  rule: CampaignRoutingRule,
  input: RoutingAttributionInput,
  tier: CampaignRoutingMatchType,
  now: Date
): RoutingMatcherRejectionReason[] {
  const reasons: RoutingMatcherRejectionReason[] = [];
  if (!isRuleEffective(rule, now)) reasons.push("inactive");
  if (rule.matchType !== tier) reasons.push("wrong_tier");
  else if (!tierMatches(rule, input, tier)) reasons.push("tier_key_mismatch");
  if (!scopeDimensionMatches(rule.nicheKey, input.nicheKey)) reasons.push("scope_nicheKey");
  if (!scopeDimensionMatches(rule.productType, input.productType)) reasons.push("scope_productType");
  if (!scopeDimensionMatches(rule.sourcePlatform, input.sourcePlatform)) reasons.push("scope_sourcePlatform");
  if (!scopeDimensionMatches(rule.sourceType, input.sourceType)) reasons.push("scope_sourceType");
  if (!scopeDimensionMatches(rule.masterDatasetId, input.masterDatasetId)) reasons.push("scope_masterDatasetId");
  return reasons;
}

/** Safe diagnostic for admin dry-run (no secrets — rule ids and reason codes only). */
export function buildRoutingMatcherDebug(
  rules: CampaignRoutingRule[],
  input: RoutingAttributionInput,
  now: Date = new Date()
): RoutingMatcherDebug {
  const activeRules = rules.filter((r) => isRuleEffective(r, now));
  const rejections: RoutingMatcherDebugRejection[] = [];

  for (const rule of rules) {
    const reasons = rejectionReasonsForRule(rule, input, rule.matchType, now).filter(
      (r) => r !== "wrong_tier"
    );
    if (reasons.length > 0) {
      rejections.push({ ruleId: rule.id, matchType: rule.matchType, reasons });
    }
  }

  return {
    extractedInput: input,
    activeRuleCount: activeRules.length,
    rejections,
  };
}

function tierMatches(
  rule: CampaignRoutingRule,
  input: RoutingAttributionInput,
  tier: CampaignRoutingMatchType
): boolean {
  switch (tier) {
    case "campaign_id": {
      const ruleId = normalizeId(rule.campaignId);
      const leadId = input.campaignId;
      return Boolean(ruleId && leadId && ruleId === leadId);
    }
    case "adset_id": {
      const ruleId = normalizeId(rule.adsetId);
      const leadId = input.adsetId;
      return Boolean(ruleId && leadId && ruleId === leadId);
    }
    case "ad_id": {
      const ruleId = normalizeId(rule.adId);
      const leadId = input.adId;
      return Boolean(ruleId && leadId && ruleId === leadId);
    }
    case "form_id_utm_campaign": {
      const ruleForm = normalizeId(rule.formId);
      const ruleUtm = normalizeId(rule.utmCampaign);
      const leadForm = input.formId;
      const leadUtm = input.utmCampaign;
      return Boolean(
        ruleForm &&
          ruleUtm &&
          leadForm &&
          leadUtm &&
          ruleForm === leadForm &&
          ruleUtm.toLowerCase() === leadUtm.toLowerCase()
      );
    }
    case "utm_campaign": {
      const ruleUtm = normalizeId(rule.utmCampaign);
      const leadUtm = input.utmCampaign;
      return Boolean(
        ruleUtm && leadUtm && ruleUtm.toLowerCase() === leadUtm.toLowerCase()
      );
    }
    case "keyword_fallback": {
      const pattern = normalizeId(rule.keywordPattern);
      if (!pattern) return false;
      const haystack = routingAttributionHaystack(input);
      return haystack.includes(pattern.toLowerCase());
    }
    default:
      return false;
  }
}

function pickBestRule(
  candidates: CampaignRoutingRule[],
  input: RoutingAttributionInput,
  tier: CampaignRoutingMatchType
): CampaignRoutingRule | undefined {
  const matching = candidates
    .filter((r) => r.matchType === tier && tierMatches(r, input, tier) && ruleScopeMatches(r, input))
    .sort((a, b) => b.priority - a.priority);
  return matching[0];
}

/**
 * Match a lead to a destination using configured rules (dry-run only).
 * Priority tiers: campaign_id → adset_id → ad_id → form+utm → utm → keyword → unmatched.
 */
export function matchCampaignRoutingRule(
  rules: CampaignRoutingRule[],
  input: RoutingAttributionInput,
  now: Date = new Date()
): RoutingMatchResult {
  const activeRules = rules.filter((r) => isRuleEffective(r, now));

  for (const tier of MATCH_TIER_ORDER) {
    const winner = pickBestRule(activeRules, input, tier);
    if (winner) {
      return {
        matched: true,
        confidence: CONFIDENCE_BY_TIER[tier],
        matchedRuleId: winner.id,
        destinationClientAccountId: winner.clientAccountId,
        destinationSubaccountIdGhl: winner.destinationSubaccountIdGhl || "",
        matchType: tier,
        reason: `Matched routing rule (${tier}) → ${winner.clientDisplayName ?? winner.clientAccountId}`,
      };
    }
  }

  return {
    matched: false,
    confidence: "none",
    reason: "No active routing rule matched attribution; manual review required",
  };
}
