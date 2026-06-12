export type SourceLeadListItem = {
  id: string;
  receivedAt: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceType: string;
  sourceRouteKey: string | null;
  sourceLeadId: string | null;
  leadName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  matched: boolean;
  matchedRuleId: string | null;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  errorSummary: string | null;
};

export type SourceLeadDetail = SourceLeadListItem & {
  sourceCampaignId: string | null;
  sourceCampaignName: string | null;
  sourceFunnelName: string | null;
  sourceLeadUid: string | null;
  rawPayloadJson: unknown;
  normalizedPayloadJson: unknown;
  routingResultJson: unknown;
  duplicateRiskJson: unknown;
  deliveryResultJson: unknown;
  routingDryRunDecisionId: string | null;
  normalizedAt: string | null;
  routedAt: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
  approvedBy: string | null;
};

export type SourceLeadListResponse = {
  ok: boolean;
  items: SourceLeadListItem[];
  nextCursor: string | null;
};

export const SOURCE_LEAD_APPROVE_CONFIRMATION = "APPROVE SOURCE LEAD DELIVERY";

export type SourceLeadApproveMode = "simulate" | "live_canary";
