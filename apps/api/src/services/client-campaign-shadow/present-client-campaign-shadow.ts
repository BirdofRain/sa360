/**
 * Read-only view of a frozen shadow decision.
 * This does not resolve, write, or disclose another client's identifiers.
 */

import type { ClientCampaignShadowDecision as ShadowRow } from "@prisma/client";

import { readCampaignLeadTypeDecision } from "../source-intake/campaign-lead-type.js";
import { SHADOW_ANALYSIS_BANNER, SHADOW_EXECUTION_AUTHORIZED } from "./resolve-client-campaign-shadow.js";

export type CampaignShadowRead = {
  ok: true;
  banner: typeof SHADOW_ANALYSIS_BANNER;
  /** Always false. A campaign id in decision is not a delivery grant. */
  executionAuthorized: typeof SHADOW_EXECUTION_AUTHORIZED;
  shadowEnabled: boolean;
  evaluation: "stored" | "not_evaluated";
  decision: {
    decisionVersion: number;
    status: string;
    evaluatedAt: string;
    clientAccountId: string | null;
    clientCampaignId: string | null;
    campaignRevision: number | null;
    campaignSlug: string | null;
    campaignDisplayName: string | null;
    campaignStatus: string | null;
    winningRoutingAuthority: string | null;
    matchType: string | null;
    provider: string | null;
    sourceEvidence: unknown;
    matchedBindingIds: unknown;
    reviewCandidateCampaignIds: unknown;
    reasonCodes: unknown;
    configuredNicheKey: string | null;
    configuredProductType: string | null;
    nicheClassificationStatus: string;
    incomingNiche: unknown;
    leadTypeDecision: unknown;
    proposedTags: unknown;
    destinationSelection: unknown;
    deliveryExecuted: false;
  } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function presentClientCampaignShadow(input: {
  row: ShadowRow | null;
  shadowEnabled: boolean;
}): CampaignShadowRead {
  if (!input.row) {
    return {
      ok: true,
      banner: SHADOW_ANALYSIS_BANNER,
      executionAuthorized: SHADOW_EXECUTION_AUTHORIZED,
      shadowEnabled: input.shadowEnabled,
      evaluation: "not_evaluated",
      decision: null,
    };
  }
  const leadType = asRecord(input.row.leadTypeDecisionJson);
  const destination = asRecord(input.row.destinationSelectionJson);
  return {
    ok: true,
    banner: SHADOW_ANALYSIS_BANNER,
    executionAuthorized: SHADOW_EXECUTION_AUTHORIZED,
    shadowEnabled: input.shadowEnabled,
    evaluation: "stored",
    decision: {
      decisionVersion: input.row.decisionVersion,
      status: input.row.status,
      evaluatedAt: input.row.evaluatedAt.toISOString(),
      clientAccountId: input.row.clientAccountId,
      clientCampaignId: input.row.clientCampaignId,
      campaignRevision: input.row.campaignRevision,
      campaignSlug: input.row.campaignSlug,
      campaignDisplayName: input.row.campaignDisplayName,
      campaignStatus: input.row.campaignStatus,
      winningRoutingAuthority: input.row.winningRoutingAuthority,
      matchType: input.row.matchType,
      provider: input.row.provider,
      sourceEvidence: input.row.sourceEvidenceJson,
      matchedBindingIds: input.row.matchedBindingIds,
      reviewCandidateCampaignIds: input.row.reviewCandidateCampaignIds,
      reasonCodes: input.row.reasonCodes,
      configuredNicheKey: input.row.configuredNicheKey,
      configuredProductType: input.row.configuredProductType,
      nicheClassificationStatus: input.row.nicheClassificationStatus,
      incomingNiche: input.row.incomingNicheJson,
      leadTypeDecision: leadType?.absent === true ? null : readCampaignLeadTypeDecision({ campaignLeadType: leadType }) ?? leadType,
      proposedTags: input.row.proposedTagsJson,
      destinationSelection: destination?.absent === true ? null : input.row.destinationSelectionJson,
      deliveryExecuted: false,
    },
  };
}
