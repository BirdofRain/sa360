/**
 * Pure client-campaign shadow resolver.
 *
 * Live routing already chose the client. Precedence there is exact
 * CampaignRoutingRule, then a confirmed source association, then a loose rule.
 * This function does not replace that client or that authority.
 *
 * A campaign is eligible only when an approved binding's provider-scoped exact
 * identifier agrees with the event and with that client. Display name, niche,
 * product, Lead Type, UTM text, and keywords are not identity. Two campaigns
 * with the same name and niche stay separate. Several bindings for one campaign
 * are one result. Different campaigns, or an identifier owned by another
 * client, are REVIEW_REQUIRED. Another client's ids are not returned.
 *
 * Niche agreement is checked after identity. A conflict does not change live
 * routing. Proposed tags are informational and are withheld unless identity
 * resolved and classification is not a conflict.
 */

import type { CampaignLeadTypeDecision } from "../source-intake/campaign-lead-type.js";
import {
  isCampaignNicheKey,
  type IdentifierKind,
} from "../client-campaign-registry/identity.js";
import {
  classifyCampaignNiche,
  type IncomingNicheEvidence,
  type NicheClassificationStatus,
} from "./niche-classification.js";
import type { ShadowSourceIdentifier } from "./source-evidence.js";

export const CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION = 1 as const;

export const SHADOW_ANALYSIS_BANNER =
  "Shadow analysis only — no campaign-specific delivery executed." as const;

export type ShadowResolutionStatus = "MATCHED" | "UNRESOLVED" | "REVIEW_REQUIRED";

export type ShadowBindingCandidate = {
  bindingId: string;
  clientCampaignId: string;
  clientAccountId: string;
  sourceFunnelId: string | null;
  sourceFunnelOriginClientAccountId: string | null;
  identities: Array<{ provider: string; kind: IdentifierKind; normalizedValue: string }>;
};

export type ShadowCampaignConfig = {
  id: string;
  clientAccountId: string;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
  revision: number;
  destination: {
    workflowIdGhl: string | null;
    workflowTriggerMode: string | null;
    ghlLocationId: string | null;
    spreadsheetId: string | null;
    worksheetId: number | null;
    worksheetTitle: string | null;
  } | null;
};

export type ShadowRoutingContext = {
  clientAccountId: string | null;
  routingAuthority: string | null;
  matchType: string | null;
  matched: boolean;
  matchedRuleId: string | null;
  confirmedSourceFunnelId: string | null;
  confirmedSourceOriginClientAccountId: string | null;
};

export type ProposedShadowTags = {
  authorized: boolean;
  nicheTag: string | null;
  campaignTag: string | null;
  reason: string | null;
  existingTagPlansPreserved: true;
  contactTagRemovalSafe: false;
  deliveryExecuted: false;
};

export type ShadowDestinationSelection = {
  informationalOnly: true;
  deliveryExecuted: false;
  workflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  ghlLocationId: string | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  workflowLiveVerified: false;
  mapPublished: false;
};

export type ClientCampaignShadowDecision = {
  version: typeof CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION;
  status: ShadowResolutionStatus;
  banner: typeof SHADOW_ANALYSIS_BANNER;
  deliveryExecuted: false;
  clientAccountId: string | null;
  clientCampaignId: string | null;
  campaignRevision: number | null;
  campaignSlug: string | null;
  campaignDisplayName: string | null;
  campaignStatus: string | null;
  configuredNicheKey: string | null;
  configuredProductType: string | null;
  winningRoutingAuthority: string | null;
  matchType: string | null;
  matchedBindingIds: string[];
  reviewCandidateCampaignIds: string[];
  reasonCodes: string[];
  provider: string | null;
  sourceEvidence: ShadowSourceIdentifier[];
  looseEvidenceIgnored: boolean;
  nicheClassificationStatus: NicheClassificationStatus;
  incomingNiche: IncomingNicheEvidence;
  leadTypeDecision: CampaignLeadTypeDecision | null;
  proposedTags: ProposedShadowTags;
  destinationSelection: ShadowDestinationSelection | null;
};

const CAMPAIGN_TAG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const REASON_ORDER = [
  "no_authoritative_client",
  "provider_missing",
  "no_exact_source_evidence",
  "loose_evidence_only",
  "cross_client_identity_conflict",
  "confirmed_source_contradiction",
  "multiple_eligible_campaigns",
  "no_approved_exact_binding",
  "niche_classification_conflict",
  "incoming_niche_unrecognized",
  "incoming_niche_missing",
] as const;

function orderedReasons(codes: string[]): string[] {
  const present = new Set(codes);
  return REASON_ORDER.filter((code) => present.has(code));
}

function identityKey(identity: { provider: string; kind: string; normalizedValue: string }): string {
  return `${identity.provider}\n${identity.kind}\n${identity.normalizedValue}`;
}

function blankTags(reason: string): ProposedShadowTags {
  return {
    authorized: false,
    nicheTag: null,
    campaignTag: null,
    reason,
    existingTagPlansPreserved: true,
    contactTagRemovalSafe: false,
    deliveryExecuted: false,
  };
}

function authorizedTags(nicheKey: string, slug: string): ProposedShadowTags {
  const nicheTag = isCampaignNicheKey(nicheKey) ? `SA360::NICHE::${nicheKey}` : null;
  const campaignTag = CAMPAIGN_TAG_SLUG.test(slug) ? `SA360::CAMPAIGN::${slug}` : null;
  if (!nicheTag) return blankTags("campaign_niche_not_catalog");
  return {
    authorized: true,
    nicheTag,
    campaignTag,
    reason: null,
    existingTagPlansPreserved: true,
    contactTagRemovalSafe: false,
    deliveryExecuted: false,
  };
}

function destinationOf(campaign: ShadowCampaignConfig | undefined): ShadowDestinationSelection | null {
  if (!campaign?.destination) return null;
  return {
    informationalOnly: true,
    deliveryExecuted: false,
    workflowIdGhl: campaign.destination.workflowIdGhl,
    workflowTriggerMode: campaign.destination.workflowTriggerMode,
    ghlLocationId: campaign.destination.ghlLocationId,
    spreadsheetId: campaign.destination.spreadsheetId,
    worksheetId: campaign.destination.worksheetId,
    worksheetTitle: campaign.destination.worksheetTitle,
    workflowLiveVerified: false,
    mapPublished: false,
  };
}

function baseDecision(input: {
  routing: ShadowRoutingContext;
  evidence: ShadowSourceIdentifier[];
  provider: string | null;
  looseEvidenceIgnored: boolean;
  incomingNiche: IncomingNicheEvidence;
  leadTypeDecision: CampaignLeadTypeDecision | null;
}): ClientCampaignShadowDecision {
  return {
    version: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
    status: "UNRESOLVED",
    banner: SHADOW_ANALYSIS_BANNER,
    deliveryExecuted: false,
    clientAccountId: input.routing.clientAccountId,
    clientCampaignId: null,
    campaignRevision: null,
    campaignSlug: null,
    campaignDisplayName: null,
    campaignStatus: null,
    configuredNicheKey: null,
    configuredProductType: null,
    winningRoutingAuthority: input.routing.routingAuthority,
    matchType: input.routing.matchType,
    matchedBindingIds: [],
    reviewCandidateCampaignIds: [],
    reasonCodes: [],
    provider: input.provider,
    sourceEvidence: input.evidence,
    looseEvidenceIgnored: input.looseEvidenceIgnored,
    nicheClassificationStatus: "UNRESOLVED",
    incomingNiche: input.incomingNiche,
    leadTypeDecision: input.leadTypeDecision,
    proposedTags: blankTags("campaign_not_resolved"),
    destinationSelection: null,
  };
}

function freezeCampaign(
  decision: ClientCampaignShadowDecision,
  campaign: ShadowCampaignConfig,
  bindingIds: string[]
): void {
  decision.clientCampaignId = campaign.id;
  decision.campaignRevision = campaign.revision;
  decision.campaignSlug = campaign.slug;
  decision.campaignDisplayName = campaign.displayName;
  decision.campaignStatus = campaign.status;
  decision.configuredNicheKey = campaign.nicheKey;
  decision.configuredProductType = campaign.productType;
  decision.matchedBindingIds = [...bindingIds].sort();
  decision.destinationSelection = destinationOf(campaign);
}

export function resolveClientCampaignShadow(input: {
  routing: ShadowRoutingContext;
  provider: string | null;
  evidence: ShadowSourceIdentifier[];
  looseEvidenceIgnored: boolean;
  hadExactValuesWithoutProvider: boolean;
  bindings: ShadowBindingCandidate[];
  campaigns: ShadowCampaignConfig[];
  incomingNiche: IncomingNicheEvidence;
  leadTypeDecision: CampaignLeadTypeDecision | null;
}): ClientCampaignShadowDecision {
  const decision = baseDecision({
    routing: input.routing,
    evidence: input.evidence,
    provider: input.provider,
    looseEvidenceIgnored: input.looseEvidenceIgnored,
    incomingNiche: input.incomingNiche,
    leadTypeDecision: input.leadTypeDecision,
  });
  const clientAccountId = input.routing.clientAccountId?.trim() || null;
  if (!clientAccountId) {
    decision.reasonCodes = orderedReasons(["no_authoritative_client"]);
    return decision;
  }
  decision.clientAccountId = clientAccountId;

  if (!input.provider && input.hadExactValuesWithoutProvider) {
    decision.reasonCodes = orderedReasons(["provider_missing"]);
    return decision;
  }
  if (input.evidence.length === 0) {
    decision.reasonCodes = orderedReasons([
      input.looseEvidenceIgnored ? "loose_evidence_only" : "no_exact_source_evidence",
    ]);
    return decision;
  }

  const evidenceKeys = new Set(input.evidence.map(identityKey));
  const matched = input.bindings.filter((binding) =>
    binding.identities.some((identity) => evidenceKeys.has(identityKey(identity)))
  );
  const otherClient = matched.some(
    (binding) =>
      binding.clientAccountId !== clientAccountId ||
      (binding.sourceFunnelOriginClientAccountId !== null &&
        binding.sourceFunnelOriginClientAccountId !== clientAccountId)
  );
  const confirmedOrigin = input.routing.confirmedSourceOriginClientAccountId;
  const confirmedOriginConflicts = Boolean(
    input.routing.confirmedSourceFunnelId &&
      confirmedOrigin &&
      confirmedOrigin !== clientAccountId
  );
  if (otherClient || confirmedOriginConflicts) {
    decision.status = "REVIEW_REQUIRED";
    decision.reasonCodes = orderedReasons(["cross_client_identity_conflict"]);
    decision.proposedTags = blankTags("cross_client_identity_conflict");
    return decision;
  }

  const sameClient = matched.filter((binding) => binding.clientAccountId === clientAccountId);
  const contradictsConfirmed = sameClient.some(
    (binding) =>
      Boolean(input.routing.confirmedSourceFunnelId) &&
      binding.sourceFunnelId !== null &&
      binding.sourceFunnelId !== input.routing.confirmedSourceFunnelId
  );
  if (contradictsConfirmed) {
    decision.status = "REVIEW_REQUIRED";
    decision.reviewCandidateCampaignIds = [...new Set(sameClient.map((binding) => binding.clientCampaignId))].sort();
    decision.matchedBindingIds = sameClient.map((binding) => binding.bindingId).sort();
    decision.reasonCodes = orderedReasons(["confirmed_source_contradiction"]);
    decision.proposedTags = blankTags("confirmed_source_contradiction");
    return decision;
  }

  const campaignIds = [...new Set(sameClient.map((binding) => binding.clientCampaignId))].sort();
  if (campaignIds.length > 1) {
    decision.status = "REVIEW_REQUIRED";
    decision.reviewCandidateCampaignIds = campaignIds;
    decision.matchedBindingIds = sameClient.map((binding) => binding.bindingId).sort();
    decision.reasonCodes = orderedReasons(["multiple_eligible_campaigns"]);
    decision.proposedTags = blankTags("multiple_eligible_campaigns");
    return decision;
  }
  if (campaignIds.length === 0) {
    decision.reasonCodes = orderedReasons(["no_approved_exact_binding"]);
    return decision;
  }

  const campaign = input.campaigns.find((item) => item.id === campaignIds[0] && item.clientAccountId === clientAccountId);
  if (!campaign) {
    decision.reasonCodes = orderedReasons(["no_approved_exact_binding"]);
    return decision;
  }
  const bindingIds = sameClient
    .filter((binding) => binding.clientCampaignId === campaign.id)
    .map((binding) => binding.bindingId);
  freezeCampaign(decision, campaign, bindingIds);
  const classification = classifyCampaignNiche({
    configuredNicheKey: campaign.nicheKey,
    incoming: input.incomingNiche,
  });
  decision.nicheClassificationStatus = classification.status;
  decision.reasonCodes = orderedReasons(classification.reasonCodes);
  if (classification.status === "CONFLICT") {
    decision.status = "REVIEW_REQUIRED";
    decision.proposedTags = blankTags("niche_classification_conflict");
    return decision;
  }
  decision.status = "MATCHED";
  decision.proposedTags = authorizedTags(campaign.nicheKey, campaign.slug);
  return decision;
}
