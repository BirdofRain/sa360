import {
  collectLeadCaptureTrustSyncBlockers,
  getLeadCaptureDataApiToken,
  getLeadCaptureTrustSyncCampaignAllowlist,
  getLeadCaptureTrustSyncFormAllowlist,
  isLeadCaptureTrustSyncCampaignAllowed,
  isLeadCaptureTrustSyncEnabled,
} from "../../lib/leadcapture-data-api-env.js";
import {
  LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
  LEADCAPTURE_TRUST_PILOT_FORM_ID,
  LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
} from "./leadcapture-trust.constants.js";

export type LeadCaptureTrustScopeBlocker =
  | "trust_sync_disabled"
  | "api_token_missing"
  | "campaign_not_allowlisted"
  | "form_not_allowlisted"
  | "provider_campaign_mismatch"
  | "provider_form_mismatch"
  | "campaign_mismatch"
  | "client_mismatch"
  | "source_lane_mismatch";

export function collectLeadCaptureTrustPilotScopeBlockers(input: {
  campaignId: string;
  providerCampaignId?: string | null;
  providerFormId?: string | null;
}): LeadCaptureTrustScopeBlocker[] {
  const blockers: LeadCaptureTrustScopeBlocker[] = [];
  const campaignId = input.campaignId.trim();

  if (!isLeadCaptureTrustSyncEnabled()) blockers.push("trust_sync_disabled");
  if (!getLeadCaptureDataApiToken()) blockers.push("api_token_missing");

  const campaignAllowlist = getLeadCaptureTrustSyncCampaignAllowlist();
  if (campaignAllowlist.length === 0 || !isLeadCaptureTrustSyncCampaignAllowed(campaignId)) {
    blockers.push("campaign_not_allowlisted");
  }
  if (campaignId !== LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY) {
    blockers.push("campaign_mismatch");
  }

  const formAllowlist = getLeadCaptureTrustSyncFormAllowlist();
  const providerFormId = input.providerFormId?.trim() ?? null;
  if (formAllowlist.length === 0) {
    blockers.push("form_not_allowlisted");
  } else if (!providerFormId || !formAllowlist.includes(providerFormId)) {
    blockers.push("form_not_allowlisted");
  }
  if (providerFormId && providerFormId !== LEADCAPTURE_TRUST_PILOT_FORM_ID) {
    blockers.push("provider_form_mismatch");
  }

  const providerCampaignId = input.providerCampaignId?.trim() ?? null;
  if (providerCampaignId && providerCampaignId !== LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY) {
    blockers.push("provider_campaign_mismatch");
  }

  return blockers;
}

export function validateSourceLeadEventPilotScope(input: {
  campaignId: string;
  sourceRouteKey: string | null | undefined;
  clientAccountIdResolved: string | null | undefined;
  sourceProvider: string;
}): LeadCaptureTrustScopeBlocker[] {
  const blockers: LeadCaptureTrustScopeBlocker[] = [];
  if (input.sourceRouteKey?.trim() !== input.campaignId.trim()) blockers.push("campaign_mismatch");
  if (input.clientAccountIdResolved?.trim() !== LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID) {
    blockers.push("client_mismatch");
  }
  if (input.sourceProvider !== LEADCAPTURE_TRUST_PILOT_SOURCE_LANE) blockers.push("source_lane_mismatch");
  return blockers;
}

export function mergeTrustSyncBlockers(input: {
  campaignId: string;
  providerCampaignId?: string | null;
  providerFormId?: string | null;
}): string[] {
  const envBlockers = collectLeadCaptureTrustSyncBlockers({
    campaignId: input.campaignId,
    formId: input.providerFormId,
  });
  const scopeBlockers = collectLeadCaptureTrustPilotScopeBlockers(input);
  return [...new Set([...envBlockers, ...scopeBlockers])];
}
