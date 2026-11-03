import type { CampaignRoutingRule } from "@prisma/client";

/**
 * Match identity and status for an active routing rule.
 * Destination credentials, sheet ids, and lead payloads are omitted.
 * `active` is the rule flag. It does not by itself describe a SourceFunnel.
 */
export type ActiveRoutingRuleIdentity = {
  id: string;
  masterClientAccountId: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  active: boolean;
  priority: number;
  matchType: CampaignRoutingRule["matchType"];
  campaignId: string | null;
  campaignName: string | null;
  formId: string | null;
  keywordPattern: string | null;
  sourcePlatform: string | null;
  sourceType: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  adsetId: string | null;
  adId: string | null;
  nicheKey: string | null;
  productType: string | null;
  deliveryEnabled: boolean;
  readinessStatus: string | null;
};

export function presentActiveRoutingRuleIdentity(rule: CampaignRoutingRule): ActiveRoutingRuleIdentity {
  return {
    id: rule.id,
    masterClientAccountId: rule.masterClientAccountId,
    clientAccountId: rule.clientAccountId,
    clientDisplayName: rule.clientDisplayName,
    active: rule.active,
    priority: rule.priority,
    matchType: rule.matchType,
    campaignId: rule.campaignId,
    campaignName: rule.campaignName,
    formId: rule.formId,
    keywordPattern: rule.keywordPattern,
    sourcePlatform: rule.sourcePlatform,
    sourceType: rule.sourceType,
    utmCampaign: rule.utmCampaign,
    utmContent: rule.utmContent,
    adsetId: rule.adsetId,
    adId: rule.adId,
    nicheKey: rule.nicheKey,
    productType: rule.productType,
    deliveryEnabled: rule.deliveryEnabled,
    readinessStatus: rule.readinessStatus,
  };
}
