/**
 * Exact identity normalization for the request-only campaign registry.
 *
 * A binding is compared on provider + identifier kind + normalized value.
 * Display name, UTM text, keyword, niche, product, and Lead Type are not identifiers.
 * A form id is not the same identity as a provider funnel id when the strings match.
 * Parent URL keys use the existing LeadCapture normalizer. Query strings are not identity.
 */

import { CLIENT_PROFILE_NICHE_OPTIONS, CLIENT_PROFILE_PRODUCT_OPTIONS } from "@sa360/shared";
import type { CampaignRoutingMatchType, SourceLeadProvider } from "@prisma/client";

import { normalizeLeadCaptureParentUrl } from "../source-intake/leadcapture-parent-url.js";

export const CAMPAIGN_NICHE_KEYS = CLIENT_PROFILE_NICHE_OPTIONS.map((option) => option.value);
export const CAMPAIGN_PRODUCT_TYPES = CLIENT_PROFILE_PRODUCT_OPTIONS.map((option) => option.value);

export const IDENTIFIER_KINDS = [
  "provider_funnel_id",
  "parent_url_key",
  "campaign_id",
  "form_id",
  "adset_id",
  "ad_id",
] as const;

export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export type BindingRequestStatus = "suggested" | "recorded" | "approved";

export type BindingEvidence = {
  note: string | null;
  observedLabel: string | null;
};

export type BindingDraft = {
  bindingKey: string;
  requestedStatus: BindingRequestStatus;
  sourceFunnelId: string | null;
  campaignRoutingRuleId: string | null;
  provider: SourceLeadProvider | null;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  campaignId: string | null;
  formId: string | null;
  adsetId: string | null;
  adId: string | null;
  evidence: BindingEvidence | null;
};

export type IdentityDraft = {
  provider: SourceLeadProvider;
  kind: IdentifierKind;
  normalizedValue: string;
};

export type IdentityProblem = {
  statusCode: 400 | 409;
  error:
    | "exact_identifier_required"
    | "duplicate_identifier"
    | "identifier_invalid"
    | "provider_identity_missing"
    | "suggested_with_exact_identifier";
};

export type PreparedBinding = {
  bindingKey: string;
  requestedStatus: BindingRequestStatus;
  sourceFunnelId: string | null;
  campaignRoutingRuleId: string | null;
  evidence: BindingEvidence;
  identities: IdentityDraft[];
};

const IDENTIFIER_LIMITS: Record<IdentifierKind, number> = {
  provider_funnel_id: 200,
  parent_url_key: 500,
  campaign_id: 200,
  form_id: 200,
  adset_id: 200,
  ad_id: 200,
};

const EXACT_FIELDS: Array<{ field: keyof BindingDraft; kind: IdentifierKind }> = [
  { field: "providerFunnelId", kind: "provider_funnel_id" },
  { field: "parentUrlKey", kind: "parent_url_key" },
  { field: "campaignId", kind: "campaign_id" },
  { field: "formId", kind: "form_id" },
  { field: "adsetId", kind: "adset_id" },
  { field: "adId", kind: "ad_id" },
];

const LOOSE_RULE_MATCHES = new Set<CampaignRoutingMatchType>(["utm_campaign", "keyword_fallback"]);

export function isCampaignNicheKey(value: string): boolean {
  return CAMPAIGN_NICHE_KEYS.includes(value);
}

export function isCampaignProductType(value: string): boolean {
  return CAMPAIGN_PRODUCT_TYPES.includes(value);
}

export function isLooseRoutingMatch(matchType: CampaignRoutingMatchType): boolean {
  return LOOSE_RULE_MATCHES.has(matchType);
}

export function identityKey(identity: Pick<IdentityDraft, "provider" | "kind" | "normalizedValue">): string {
  return `${identity.provider}\n${identity.kind}\n${identity.normalizedValue}`;
}

/**
 * Public conflict view. Another client's id, name, and rule id are omitted.
 * The same client's other campaign id is included because that operator owns it.
 */
export function publicExactOverlap(input: {
  kind: IdentifierKind;
  ownerClientAccountId: string;
  ownerCampaignId: string;
  currentClientAccountId: string;
}): { code: "exact_identifier_overlap"; scope: "same_client" | "other_client"; identifierKind: IdentifierKind; campaignId?: string } {
  if (input.ownerClientAccountId === input.currentClientAccountId) {
    return {
      code: "exact_identifier_overlap",
      scope: "same_client",
      identifierKind: input.kind,
      campaignId: input.ownerCampaignId,
    };
  }
  return {
    code: "exact_identifier_overlap",
    scope: "other_client",
    identifierKind: input.kind,
  };
}

export function prepareBinding(input: BindingDraft): { ok: true; binding: PreparedBinding } | ({ ok: false } & IdentityProblem) {
  const presentFields = EXACT_FIELDS.filter((field) => {
    const raw = input[field.field];
    return typeof raw === "string" && raw.trim().length > 0;
  });
  if (input.requestedStatus === "suggested" && presentFields.length > 0) {
    return { ok: false, statusCode: 409, error: "suggested_with_exact_identifier" };
  }
  const identities: IdentityDraft[] = [];
  const seen = new Set<string>();
  for (const field of presentFields) {
    const raw = input[field.field];
    if (typeof raw !== "string") continue;
    if (!input.provider || input.provider === "unknown") {
      return { ok: false, statusCode: 409, error: "provider_identity_missing" };
    }
    const normalized = normalizeCampaignIdentifier(field.kind, raw);
    if (!normalized) return { ok: false, statusCode: 400, error: "identifier_invalid" };
    const draft = { provider: input.provider, kind: field.kind, normalizedValue: normalized };
    const key = identityKey(draft);
    if (seen.has(key)) return { ok: false, statusCode: 409, error: "duplicate_identifier" };
    seen.add(key);
    identities.push(draft);
  }

  if (input.requestedStatus !== "suggested" && identities.length === 0) {
    return { ok: false, statusCode: 409, error: "exact_identifier_required" };
  }

  return {
    ok: true,
    binding: {
      bindingKey: input.bindingKey,
      requestedStatus: input.requestedStatus,
      sourceFunnelId: blank(input.sourceFunnelId),
      campaignRoutingRuleId: blank(input.campaignRoutingRuleId),
      evidence: {
        note: clip(input.evidence?.note ?? null, 500),
        observedLabel: clip(input.evidence?.observedLabel ?? null, 200),
      },
      identities,
    },
  };
}

/**
 * A funnel reference corroborates only the identifier kinds that funnel stores.
 * Approval requires the stored value to be present and equal.
 * A recorded binding may keep a supplied id when the funnel has not stored that kind.
 * A stored value that differs is inconsistent for every status.
 * Form, campaign, ad set, and ad ids are not compared to the funnel.
 */
export function funnelIdentifierConsistent(input: {
  requestedStatus: BindingRequestStatus;
  identities: IdentityDraft[];
  providerFunnelId: string | null;
  parentUrlKey: string | null;
}): boolean {
  for (const identity of input.identities) {
    const stored =
      identity.kind === "provider_funnel_id"
        ? storedProviderFunnelId(input.providerFunnelId)
        : identity.kind === "parent_url_key"
          ? storedParentUrlKey(input.parentUrlKey)
          : undefined;
    if (stored === undefined) continue;
    if (input.requestedStatus === "approved") {
      if (!stored || stored !== identity.normalizedValue) return false;
    } else if (stored && stored !== identity.normalizedValue) {
      return false;
    }
  }
  return true;
}

export function duplicateIdentityInSet(bindings: PreparedBinding[]): boolean {
  const seen = new Set<string>();
  for (const binding of bindings) {
    for (const identity of binding.identities) {
      const key = identityKey(identity);
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }
  return false;
}

function normalizeIdentifier(kind: IdentifierKind, value: string, max: number): string | null {
  if (kind === "parent_url_key") return normalizeParentUrlIdentity(value);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) return null;
  if (/\s/.test(trimmed) || trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("*")) return null;
  return trimmed;
}

/** Provider-scoped exact identifier. Display names, UTM text, and keywords do not pass. */
export function normalizeCampaignIdentifier(kind: IdentifierKind, value: string): string | null {
  return normalizeIdentifier(kind, value, IDENTIFIER_LIMITS[kind]);
}

export function normalizeParentUrlIdentity(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const normalized = normalizeLeadCaptureParentUrl(candidate);
  if (!normalized) return null;
  if (normalized.parentUrlKey.length > 500) return null;
  return normalized.parentUrlKey;
}

function storedProviderFunnelId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function storedParentUrlKey(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return normalizeParentUrlIdentity(trimmed) ?? trimmed;
}

function blank(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function clip(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}
