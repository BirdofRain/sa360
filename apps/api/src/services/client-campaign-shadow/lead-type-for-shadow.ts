/**
 * Lead Type copy for a shadow decision.
 *
 * A stored routing snapshot is copied and is not recalculated.
 * A new decision uses the #347 resolver: operator configuration on the winning
 * binding, or the trusted integration field sa360_campaign_lead_type.
 * Niche, product, URL, campaign name, and consumer answers are not Lead Type.
 */

import type { CampaignLeadTypeDecision } from "../source-intake/campaign-lead-type.js";
import {
  readCampaignLeadTypeDecision,
  readTrustedCampaignLeadType,
  resolveCampaignLeadType,
} from "../source-intake/campaign-lead-type.js";

export function leadTypeForShadow(input: {
  routingResult: unknown;
  rawPayload: unknown;
  normalizedPayload: unknown;
  routingAuthority?: string | null;
  matched: boolean;
  matchedRuleId?: string | null;
  matchType?: string | null;
  sourceAssociation?: { id: string; leadTypeKey: string | null } | null;
  observedSource?: { id: string; leadTypeKey: string | null } | null;
}): CampaignLeadTypeDecision {
  const stored = readCampaignLeadTypeDecision(input.routingResult);
  if (stored) return stored;
  return resolveCampaignLeadType({
    routingAuthority: input.routingAuthority,
    matched: input.matched,
    matchedRuleId: input.matchedRuleId,
    matchType: input.matchType,
    sourceAssociation: input.sourceAssociation,
    observedSource: input.observedSource,
    trusted:
      readTrustedCampaignLeadType(input.rawPayload) ??
      readTrustedCampaignLeadType(input.normalizedPayload),
  });
}
