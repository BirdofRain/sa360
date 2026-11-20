/**
 * Exact source identifiers for shadow campaign resolution.
 *
 * Provider, kind, and normalized value must all agree with an approved binding.
 * UTM text, keywords, display names, and niche values are not identifiers.
 * A form id is not the same kind as a provider funnel id.
 */

import {
  IDENTIFIER_KINDS,
  normalizeCampaignIdentifier,
  type IdentifierKind,
} from "../client-campaign-registry/identity.js";

export type ShadowSourceIdentifier = {
  provider: string;
  kind: IdentifierKind;
  normalizedValue: string;
};

export type ShadowSourceEvidence = {
  provider: string | null;
  identifiers: ShadowSourceIdentifier[];
  looseEvidenceIgnored: boolean;
};

const LOOSE_MATCH_TYPES = new Set(["utm_campaign", "keyword_fallback"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function present(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractShadowSourceEvidence(input: {
  provider: string | null;
  rawPayload: unknown;
  normalizedPayload: unknown;
  routingResult: unknown;
  matchType?: string | null;
}): ShadowSourceEvidence {
  const provider = input.provider?.trim() || null;
  const usableProvider = provider && provider !== "unknown" ? provider : null;
  const raw = asRecord(input.rawPayload);
  const normalized = asRecord(input.normalizedPayload);
  const routing = asRecord(input.routingResult);
  const association = asRecord(routing?.sourceAssociation);
  const normRouting = asRecord(normalized?.routing);
  const intake = asRecord(normRouting?.source_intake);
  const attribution = asRecord(normalized?.attribution);
  const seen = new Set<string>();
  const identifiers: ShadowSourceIdentifier[] = [];

  const push = (kind: IdentifierKind, value: unknown) => {
    if (!usableProvider) return;
    const rawValue = present(value);
    if (!rawValue) return;
    const normalizedValue = normalizeCampaignIdentifier(kind, rawValue);
    if (!normalizedValue) return;
    const key = `${usableProvider}\n${kind}\n${normalizedValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    identifiers.push({ provider: usableProvider, kind, normalizedValue });
  };

  push("provider_funnel_id", association?.providerFunnelId);
  push("provider_funnel_id", intake?.funnel_id);
  push("provider_funnel_id", raw?.funnel_id);
  push("provider_funnel_id", raw?.sa360_funnel_id);

  push("parent_url_key", association?.parentUrlKey);
  push("parent_url_key", intake?.parent_url_key);
  push("parent_url_key", raw?.parent_url_key);
  push("parent_url_key", raw?.parent_url);
  push("parent_url_key", raw?.sa360_parent_url);

  push("form_id", intake?.form_id);
  push("form_id", normRouting?.form_id);
  push("form_id", normRouting?.lead_form_id);
  push("form_id", raw?.form_id);
  push("form_id", raw?.sa360_form_id);

  push("campaign_id", attribution?.campaign_id);
  push("campaign_id", raw?.campaign_id);
  push("campaign_id", raw?.sa360_campaign_id);

  push("adset_id", attribution?.adset_id);
  push("adset_id", raw?.adset_id);
  push("adset_id", raw?.sa360_adset_id);

  push("ad_id", attribution?.ad_id);
  push("ad_id", raw?.ad_id);
  push("ad_id", raw?.sa360_ad_id);

  const looseMatch = Boolean(input.matchType && LOOSE_MATCH_TYPES.has(input.matchType));
  const utmPresent = Boolean(
    present(attribution?.utm_campaign) ||
      present(raw?.utm_campaign) ||
      present(attribution?.utm_content) ||
      present(raw?.utm_content)
  );
  identifiers.sort((left, right) => {
    const kindOrder = IDENTIFIER_KINDS.indexOf(left.kind) - IDENTIFIER_KINDS.indexOf(right.kind);
    if (kindOrder !== 0) return kindOrder;
    return left.normalizedValue.localeCompare(right.normalizedValue);
  });
  return {
    provider: usableProvider,
    identifiers,
    looseEvidenceIgnored: looseMatch || utmPresent,
  };
}
