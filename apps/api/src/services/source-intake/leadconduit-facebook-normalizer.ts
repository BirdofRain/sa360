import { createHash } from "node:crypto";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";

export const LEADCONDUIT_FACEBOOK_PROVIDER = "facebook" as const;
export const LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM = "external_vendor" as const;
export const LEADCONDUIT_FACEBOOK_SOURCE_LANE = "leadconduit_facebook" as const;

type LeadConduitReplayIdentityBasis =
  | "delivery_id"
  | "facebook_leadgen_id"
  | "source_lead_id"
  | "stable_non_pii_fallback";

export type LeadConduitReplayIdentity = {
  replayKey: string;
  replayBasis: LeadConduitReplayIdentityBasis;
};

export type LeadConduitFacebookFields = {
  deliveryId?: string;
  sourceLeadId: string;
  leadgenId?: string;
  facebookLeadId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  state?: string;
  postalCode?: string;
  submittedAt: string;
  pageId?: string;
  formId?: string;
  formName?: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  nicheKey?: string;
  subNicheKey?: string;
  angleKey?: string;
  productType?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  ipAddress?: string;
  userAgent?: string;
  referrerUrl?: string;
  trustedFormCertUrl?: string;
  trustedFormReference?: string;
  consentDisclosureId?: string;
  consentText?: string;
  consentVersion?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = record;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstString(record: Record<string, unknown>, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = readString(getPath(record, path));
    if (value) return value;
  }
  return undefined;
}

function firstSubmittedAt(record: Record<string, unknown>): string {
  const raw =
    firstString(record, [
      "submitted_at",
      "submittedAt",
      "created_time",
      "createdTime",
      "received_at",
      "receivedAt",
      "lead.created_time",
      "lead.createdTime",
      "facebook.created_time",
      "facebook.createdTime",
    ]) ?? new Date().toISOString();
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}

function leadConduitFallbackLeadId(record: Record<string, unknown>): string {
  const stableSeed = JSON.stringify({
    page_id: firstString(record, ["page_id", "facebook.page_id"]),
    form_id: firstString(record, ["form_id", "facebook.form_id"]),
    campaign_id: firstString(record, ["campaign_id", "facebook.campaign_id"]),
    adset_id: firstString(record, ["adset_id", "facebook.adset_id"]),
    ad_id: firstString(record, ["ad_id", "facebook.ad_id"]),
    submitted_at: firstSubmittedAt(record),
  });
  const digest = createHash("sha256").update(stableSeed).digest("hex").slice(0, 20);
  return `leadconduit_fb_${digest}`;
}

function nonPiiReplayFallback(record: Record<string, unknown>): string {
  const seed = JSON.stringify({
    page_id: firstString(record, ["page_id", "facebook.page_id"]),
    form_id: firstString(record, ["form_id", "facebook.form_id"]),
    campaign_id: firstString(record, ["campaign_id", "facebook.campaign_id"]),
    adset_id: firstString(record, ["adset_id", "facebook.adset_id"]),
    ad_id: firstString(record, ["ad_id", "facebook.ad_id"]),
    submitted_at: firstSubmittedAt(record),
  });
  return createHash("sha256").update(seed).digest("hex").slice(0, 28);
}

export function extractLeadConduitFacebookFields(raw: Record<string, unknown>): LeadConduitFacebookFields {
  const deliveryId = firstString(raw, [
    "delivery_id",
    "deliveryId",
    "event_id",
    "eventId",
    "leadconduit.delivery_id",
    "leadconduit.event_id",
    "leadconduit.eventId",
  ]);
  const leadgenId = firstString(raw, [
    "leadgen_id",
    "leadgenId",
    "facebook_lead_id",
    "facebookLeadId",
    "lead.id",
    "facebook.leadgen_id",
    "facebook.leadgenId",
  ]);
  const sourceLeadId =
    leadgenId ??
    firstString(raw, [
      "source_lead_id",
      "sourceLeadId",
      "lead_id",
      "leadId",
      "lead.id",
    ]) ??
    leadConduitFallbackLeadId(raw);

  return {
    deliveryId,
    sourceLeadId,
    leadgenId,
    facebookLeadId: firstString(raw, ["facebook_lead_id", "facebookLeadId"]),
    firstName: firstString(raw, [
      "first_name",
      "firstName",
      "lead.first_name",
      "lead.firstName",
    ]),
    lastName: firstString(raw, [
      "last_name",
      "lastName",
      "lead.last_name",
      "lead.lastName",
    ]),
    phone: firstString(raw, [
      "phone",
      "phone_number",
      "phoneNumber",
      "lead.phone",
      "lead.phone_number",
    ]),
    email: firstString(raw, ["email", "email_address", "lead.email", "lead.email_address"]),
    state: firstString(raw, ["state", "state_code", "lead.state"]),
    postalCode: firstString(raw, ["postal_code", "postalCode", "zip", "zip_code", "lead.zip"]),
    submittedAt: firstSubmittedAt(raw),
    pageId: firstString(raw, ["page_id", "pageId", "facebook.page_id"]),
    formId: firstString(raw, ["form_id", "formId", "facebook.form_id", "facebook_form_id"]),
    formName: firstString(raw, ["form_name", "formName", "facebook.form_name"]),
    campaignId: firstString(raw, ["campaign_id", "campaignId", "facebook.campaign_id"]),
    campaignName: firstString(raw, ["campaign_name", "campaignName", "facebook.campaign_name"]),
    adsetId: firstString(raw, ["adset_id", "adsetId", "facebook.adset_id"]),
    adsetName: firstString(raw, ["adset_name", "adsetName", "facebook.adset_name"]),
    adId: firstString(raw, ["ad_id", "adId", "facebook.ad_id"]),
    adName: firstString(raw, ["ad_name", "adName", "facebook.ad_name"]),
    nicheKey: firstString(raw, ["niche_key", "nicheKey", "classification.niche_key"]),
    subNicheKey: firstString(raw, [
      "sub_niche_key",
      "subNicheKey",
      "classification.sub_niche_key",
    ]),
    angleKey: firstString(raw, ["angle_key", "angleKey", "classification.angle_key"]),
    productType: firstString(raw, ["product_type", "productType", "classification.product_type"]),
    fbclid: firstString(raw, ["fbclid", "tracking.fbclid"]),
    fbc: firstString(raw, ["fbc", "tracking.fbc"]),
    fbp: firstString(raw, ["fbp", "tracking.fbp"]),
    utmSource: firstString(raw, ["utm_source", "utmSource", "tracking.utm_source"]),
    utmMedium: firstString(raw, ["utm_medium", "utmMedium", "tracking.utm_medium"]),
    utmCampaign: firstString(raw, ["utm_campaign", "utmCampaign", "tracking.utm_campaign"]),
    utmContent: firstString(raw, ["utm_content", "utmContent", "tracking.utm_content"]),
    utmTerm: firstString(raw, ["utm_term", "utmTerm", "tracking.utm_term"]),
    ipAddress: firstString(raw, ["ip_address", "ipAddress", "tracking.ip_address"]),
    userAgent: firstString(raw, ["user_agent", "userAgent", "tracking.user_agent"]),
    referrerUrl: firstString(raw, ["referrer_url", "referrerUrl", "tracking.referrer_url"]),
    trustedFormCertUrl: firstString(raw, [
      "trustedform_cert_url",
      "trustedformCertUrl",
      "xxTrustedFormCertUrl",
      "trustedform_certificate_url",
      "trustedform.certificate_url",
      "proof.trustedform_cert_url",
    ]),
    trustedFormReference: firstString(raw, [
      "trustedform_reference",
      "trustedformReference",
      "trustedform.certificate_id",
    ]),
    consentDisclosureId: firstString(raw, [
      "consent_disclosure_id",
      "consentDisclosureId",
      "disclosure_id",
      "disclosureId",
    ]),
    consentText: firstString(raw, ["consent_text", "consentText", "disclosure_text"]),
    consentVersion: firstString(raw, ["consent_version", "consentVersion", "disclosure_version"]),
  };
}

export function resolveLeadConduitReplayIdentity(
  raw: Record<string, unknown>,
  fields: LeadConduitFacebookFields = extractLeadConduitFacebookFields(raw)
): LeadConduitReplayIdentity {
  if (fields.deliveryId) {
    return {
      replayKey: `delivery:${fields.deliveryId}`,
      replayBasis: "delivery_id",
    };
  }
  if (fields.leadgenId) {
    return {
      replayKey: `leadgen:${fields.leadgenId}`,
      replayBasis: "facebook_leadgen_id",
    };
  }
  if (fields.sourceLeadId) {
    return {
      replayKey: `source_lead:${fields.sourceLeadId}`,
      replayBasis: "source_lead_id",
    };
  }
  return {
    replayKey: `fallback:${nonPiiReplayFallback(raw)}`,
    replayBasis: "stable_non_pii_fallback",
  };
}

export function buildLeadConduitSourceLeadUid(replayIdentity: LeadConduitReplayIdentity): string {
  const digest = createHash("sha256")
    .update(replayIdentity.replayKey)
    .digest("hex")
    .slice(0, 28);
  return `leadconduit-facebook-${digest}`;
}

export function buildLeadConduitLeadUid(sourceLeadId: string): string {
  return `leadconduit-facebook-${sourceLeadId}`;
}

export function resolveLeadConduitRouteKey(fields: LeadConduitFacebookFields): string {
  return (
    fields.formId ??
    fields.campaignId ??
    fields.pageId ??
    fields.sourceLeadId
  );
}

export function canNormalizeLeadConduitFacebookPayload(
  raw: unknown
): raw is Record<string, unknown> {
  const record = asRecord(raw);
  if (!record) return false;
  const hasExplicitReplayIdentity = Boolean(
    firstString(record, [
      "delivery_id",
      "deliveryId",
      "event_id",
      "eventId",
      "leadgen_id",
      "leadgenId",
      "facebook_lead_id",
      "facebookLeadId",
      "source_lead_id",
      "sourceLeadId",
      "lead_id",
      "leadId",
    ])
  );
  if (hasExplicitReplayIdentity) return true;

  const stableNonPiiSignals = [
    firstString(record, ["page_id", "pageId", "facebook.page_id"]),
    firstString(record, ["form_id", "formId", "facebook.form_id"]),
    firstString(record, ["campaign_id", "campaignId", "facebook.campaign_id"]),
    firstString(record, ["adset_id", "adsetId", "facebook.adset_id"]),
    firstString(record, ["ad_id", "adId", "facebook.ad_id"]),
  ].filter(Boolean);
  return stableNonPiiSignals.length >= 2;
}

function buildEventUuid(replayIdentity: LeadConduitReplayIdentity): string {
  const digest = createHash("sha256")
    .update(replayIdentity.replayKey)
    .digest("hex")
    .slice(0, 24);
  return `LCFB-${digest}`;
}

export type NormalizeLeadConduitFacebookOptions = {
  masterClientAccountId: string;
  replayIdentity?: LeadConduitReplayIdentity;
};

export function normalizeLeadConduitFacebookToLifecyclePayload(
  raw: Record<string, unknown>,
  opts: NormalizeLeadConduitFacebookOptions
): LifecycleEventSchema {
  const fields = extractLeadConduitFacebookFields(raw);
  const replayIdentity = opts.replayIdentity ?? resolveLeadConduitReplayIdentity(raw, fields);
  const sourceRouteKey = resolveLeadConduitRouteKey(fields);
  const phoneRaw = fields.phone ?? "";
  const phoneResult = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
  const phoneE164 = phoneResult?.ok ? phoneResult.e164 : undefined;

  return {
    schema_version: "MASTER 2.0",
    client_account_id: opts.masterClientAccountId,
    subaccount_id_ghl: opts.masterClientAccountId,
    contact: {
      lead_uid: buildLeadConduitLeadUid(fields.sourceLeadId),
      first_name: fields.firstName,
      last_name: fields.lastName,
      email: fields.email,
      phone: phoneRaw || undefined,
      phone_e164: phoneE164,
      state: fields.state,
      zip: fields.postalCode,
    },
    attribution: {
      source_platform: "facebook",
      source_type: "leadconduit_facebook_lead_form",
      campaign_id: fields.campaignId,
      campaign_name: fields.campaignName,
      adset_id: fields.adsetId,
      adset_name: fields.adsetName,
      ad_id: fields.adId,
      ad_name: fields.adName,
      fbclid: fields.fbclid,
      fbc: fields.fbc,
      fbp: fields.fbp,
      utm_source: fields.utmSource,
      utm_medium: fields.utmMedium,
      utm_campaign: fields.utmCampaign,
      utm_content: fields.utmContent,
      utm_term: fields.utmTerm,
    },
    state: {
      lifecycle_stage: "NEW",
      routing_status: "RECEIVED",
      lead_type: fields.productType ?? fields.nicheKey,
    },
    event: {
      event_uuid: buildEventUuid(replayIdentity),
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    routing: {
      niche_key: fields.nicheKey,
      sub_niche_key: fields.subNicheKey,
      angle_key: fields.angleKey,
      product_type: fields.productType,
      page_id: fields.pageId,
      form_id: fields.formId,
      form_name: fields.formName,
      campaign_key: sourceRouteKey,
      source_intake: {
        provider: "leadconduit",
        source_system: LEADCONDUIT_FACEBOOK_SOURCE_LANE,
        source_type: "facebook_lead_form",
        source_route_key: sourceRouteKey,
        lead_id: fields.sourceLeadId,
        leadgen_id: fields.leadgenId,
        facebook_lead_id: fields.facebookLeadId ?? fields.leadgenId,
        delivery_id: fields.deliveryId,
        replay_basis: replayIdentity.replayBasis,
        replay_key: replayIdentity.replayKey,
        submitted_at: fields.submittedAt,
        sourceAttributes: {
          source_lead_id: fields.sourceLeadId,
          leadgen_id: fields.leadgenId,
          facebook_lead_id: fields.facebookLeadId ?? fields.leadgenId,
          page_id: fields.pageId,
          form_id: fields.formId,
          form_name: fields.formName,
          campaign_id: fields.campaignId,
          campaign_name: fields.campaignName,
          adset_id: fields.adsetId,
          adset_name: fields.adsetName,
          ad_id: fields.adId,
          ad_name: fields.adName,
          niche_key: fields.nicheKey,
          sub_niche_key: fields.subNicheKey,
          angle_key: fields.angleKey,
          product_type: fields.productType,
          fbclid: fields.fbclid,
          fbc: fields.fbc,
          fbp: fields.fbp,
          utm_source: fields.utmSource,
          utm_medium: fields.utmMedium,
          utm_campaign: fields.utmCampaign,
          utm_content: fields.utmContent,
          utm_term: fields.utmTerm,
          ip_address: fields.ipAddress,
          user_agent: fields.userAgent,
          referrer_url: fields.referrerUrl,
          trustedform_cert_url: fields.trustedFormCertUrl,
          trustedform_external_reference: fields.trustedFormReference,
          consent_disclosure_id: fields.consentDisclosureId,
          consent_text: fields.consentText,
          consent_version: fields.consentVersion,
          submitted_at: fields.submittedAt,
          delivery_id: fields.deliveryId,
        },
        compliance: {
          trustedform_cert_url: fields.trustedFormCertUrl,
          trustedform_external_reference: fields.trustedFormReference,
          consent_disclosure_id: fields.consentDisclosureId,
          consent_text: fields.consentText,
          consent_version: fields.consentVersion,
          submitted_at: fields.submittedAt,
          ip_address: fields.ipAddress,
          user_agent: fields.userAgent,
          referrer_url: fields.referrerUrl,
          leadgen_id: fields.leadgenId,
          delivery_id: fields.deliveryId,
        },
      },
    },
  };
}
