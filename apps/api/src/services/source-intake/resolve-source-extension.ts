import { buildFacebookLeadUid } from "./facebook-lead-normalizer.js";
import type { FacebookFormAssociationResolution } from "./facebook-form-association.service.js";

export type ResolveSourceCaptureIdentity = {
  leadgenId: string;
  pageId?: string | null;
  formId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  adgroupId?: string | null;
  adAccountId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  customFields?: Record<string, string> | null;
};

/**
 * Capture-time snapshot for a later One-Click Resolve Source workflow.
 *
 * This module does not resolve a client, create a SourceFunnel, recapture a
 * lead, or start delivery. It records the identity and the constraints that
 * workflow must keep. The current confirmed association remains Page + Form.
 * That key is not treated as proof that every campaign on the form belongs to
 * one client.
 */

export const RESOLVE_SOURCE_CONTRACT_VERSION = 1 as const;

export const RESOLVE_SOURCE_REEVALUATE_PATH =
  "/admin/v1/facebook-capture/events/:sourceEventId/reevaluate-association" as const;

export type ResolveSourceExtension = {
  contractVersion: typeof RESOLVE_SOURCE_CONTRACT_VERSION;
  implemented: false;
  sourceLeadUid: string;
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adId: string | null;
  adgroupId: string | null;
  adAccountId: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
  };
  answerFieldNames: string[];
  answersRetainedOn: "normalizedPayload.custom_fields";
  associationOutcomeAtCapture: FacebookFormAssociationResolution["outcome"];
  associationScope: "page_form";
  pageFormIdentifiesOneClient: false;
  confirmedClientAccountId: string | null;
  sourceFunnelId: string | null;
  reevaluate: {
    eligibleWhen: "settled_capture_only_meta_or_zapier_not_delivered_not_inventoried";
    existingEndpoint: typeof RESOLVE_SOURCE_REEVALUATE_PATH;
    appliesTo: ["meta_lead_ads", "zapier_facebook"];
    recapturesLead: false;
    startsDelivery: false;
    createsClient: false;
  };
  deliveryOnLaterMatch: false;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildResolveSourceExtension(input: {
  fields: ResolveSourceCaptureIdentity;
  association: FacebookFormAssociationResolution;
}): ResolveSourceExtension {
  return {
    contractVersion: RESOLVE_SOURCE_CONTRACT_VERSION,
    implemented: false,
    sourceLeadUid: buildFacebookLeadUid(input.fields.leadgenId),
    leadgenId: input.fields.leadgenId,
    pageId: text(input.fields.pageId),
    formId: text(input.fields.formId),
    campaignId: text(input.fields.campaignId),
    campaignName: text(input.fields.campaignName),
    adsetId: text(input.fields.adsetId),
    adId: text(input.fields.adId),
    adgroupId: text(input.fields.adgroupId),
    adAccountId: text(input.fields.adAccountId),
    utm: {
      source: text(input.fields.utmSource),
      medium: text(input.fields.utmMedium),
      campaign: text(input.fields.utmCampaign),
      content: text(input.fields.utmContent),
      term: text(input.fields.utmTerm),
    },
    answerFieldNames: Object.keys(input.fields.customFields ?? {}).sort(),
    answersRetainedOn: "normalizedPayload.custom_fields",
    associationOutcomeAtCapture: input.association.outcome,
    associationScope: "page_form",
    pageFormIdentifiesOneClient: false,
    confirmedClientAccountId: input.association.clientAccountId,
    sourceFunnelId: input.association.sourceFunnelId,
    reevaluate: {
      eligibleWhen: "settled_capture_only_meta_or_zapier_not_delivered_not_inventoried",
      existingEndpoint: RESOLVE_SOURCE_REEVALUATE_PATH,
      appliesTo: ["meta_lead_ads", "zapier_facebook"],
      recapturesLead: false,
      startsDelivery: false,
      createsClient: false,
    },
    deliveryOnLaterMatch: false,
  };
}
