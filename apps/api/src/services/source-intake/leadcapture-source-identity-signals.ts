/**
 * Deterministic LeadCapture source identity signals.
 *
 * One extractor shared by both LeadCapture lanes (Legacy webhook and Next-Gen)
 * so a confirmed client source association is matched from the same evidence
 * everywhere: route key, provider funnel/form id, normalized hostname+pathname,
 * and — only inside the known `my.leadcapture.io` namespace — the hosted slug.
 *
 * URL identity always comes from `normalizeLeadCaptureParentUrl`; this module
 * never re-implements URL normalization and never drops the hostname.
 */

import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  coerceLeadCaptureLeadIdValue,
  resolveLeadCaptureField,
} from "./leadcapture-payload-resolver.js";
import {
  LEADCAPTURE_HOSTED_PAGE_HOST,
  normalizeLeadCaptureParentUrl,
  type NormalizedLeadCaptureParentUrl,
} from "./leadcapture-parent-url.js";

/**
 * Provider funnel/form id fields in matching precedence order.
 * `lead_form` is the Legacy LeadCapture form identifier (e.g. `24133`).
 */
export const LEADCAPTURE_PROVIDER_FORM_ID_FIELDS = [
  "funnel_id",
  "form_id",
  "sa360_form_id",
  "lead_form",
] as const;

export type LeadCaptureSourceIdentitySignals = {
  /** `sa360_route_key` / endpoint route key. Compatibility metadata, never a page identity. */
  routeKey: string | null;
  /** Provider funnel/form ids, de-duplicated, in precedence order. */
  providerFormIds: string[];
  /** Canonical `hostname + pathname`. Query and fragment are never part of identity. */
  parentUrlKey: string | null;
  parentUrlHostname: string | null;
  parentUrlPathname: string | null;
  /** Last path segment, only when the page is hosted on `my.leadcapture.io`. */
  hostedPageSlug: string | null;
};

export const EMPTY_LEADCAPTURE_SOURCE_IDENTITY_SIGNALS: LeadCaptureSourceIdentitySignals = {
  routeKey: null,
  providerFormIds: [],
  parentUrlKey: null,
  parentUrlHostname: null,
  parentUrlPathname: null,
  hostedPageSlug: null,
};

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** True when a normalized page lives in the standard LeadCapture hosted namespace. */
export function isHostedLeadCapturePage(
  normalized: Pick<NormalizedLeadCaptureParentUrl, "hostname">
): boolean {
  return normalized.hostname === LEADCAPTURE_HOSTED_PAGE_HOST;
}

function dedupe(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function signalsFromParentUrl(
  normalized: NormalizedLeadCaptureParentUrl | null
): Pick<
  LeadCaptureSourceIdentitySignals,
  "parentUrlKey" | "parentUrlHostname" | "parentUrlPathname" | "hostedPageSlug"
> {
  if (!normalized) {
    return {
      parentUrlKey: null,
      parentUrlHostname: null,
      parentUrlPathname: null,
      hostedPageSlug: null,
    };
  }
  return {
    parentUrlKey: normalized.parentUrlKey,
    parentUrlHostname: normalized.hostname,
    parentUrlPathname: normalized.pathname,
    hostedPageSlug: isHostedLeadCapturePage(normalized) ? normalized.pageSlug : null,
  };
}

/**
 * Extract identity signals from a provider payload (raw or materialized).
 * Reads top-level, `answers`, and the Legacy native `form` envelope through the
 * shared field resolver, so nested `parent_url` / `lead_form` is found too.
 */
export function leadCaptureSourceIdentitySignalsFromPayload(
  raw: Record<string, unknown>,
  routeKey?: string | null
): LeadCaptureSourceIdentitySignals {
  const providerFormIds = dedupe(
    LEADCAPTURE_PROVIDER_FORM_ID_FIELDS.map((field) =>
      coerceLeadCaptureLeadIdValue(resolveLeadCaptureField(raw, field))
    )
  );
  const parentUrl = normalizeLeadCaptureParentUrl(resolveLeadCaptureField(raw, "parent_url"));
  return {
    routeKey:
      trimOrNull(routeKey) ?? trimOrNull(resolveLeadCaptureField(raw, "sa360_route_key")),
    providerFormIds,
    ...signalsFromParentUrl(parentUrl),
  };
}

/**
 * Extract identity signals from a persisted normalized lifecycle payload.
 *
 * Works for events normalized before `parent_url_key` was materialized, because
 * the preserved `routing.source_intake.sourceAttributes.parent_url` is
 * re-normalized through the same canonical function.
 */
export function leadCaptureSourceIdentitySignalsFromLifecyclePayload(
  payload: LifecycleEventSchema
): LeadCaptureSourceIdentitySignals {
  const routing = asRecord(payload.routing);
  const sourceIntake = asRecord(routing?.source_intake);
  const sourceAttributes = asRecord(sourceIntake?.sourceAttributes);
  const compliance = asRecord(sourceIntake?.compliance);

  const storedParentUrlKey = trimOrNull(sourceIntake?.parent_url_key);
  const parentUrl =
    (storedParentUrlKey ? normalizeLeadCaptureParentUrl(`https://${storedParentUrlKey}`) : null) ??
    normalizeLeadCaptureParentUrl(sourceIntake?.parent_url) ??
    normalizeLeadCaptureParentUrl(sourceAttributes?.parent_url);

  const providerFormIds = dedupe([
    coerceLeadCaptureLeadIdValue(sourceIntake?.funnel_id),
    coerceLeadCaptureLeadIdValue(sourceIntake?.form_id),
    coerceLeadCaptureLeadIdValue(routing?.funnel_id),
    coerceLeadCaptureLeadIdValue(routing?.form_id),
    coerceLeadCaptureLeadIdValue(sourceIntake?.lead_form),
    coerceLeadCaptureLeadIdValue(compliance?.lead_form),
    coerceLeadCaptureLeadIdValue(sourceAttributes?.lead_form),
  ]);

  return {
    routeKey: trimOrNull(sourceIntake?.source_route_key),
    providerFormIds,
    ...signalsFromParentUrl(parentUrl),
  };
}

export function hasLeadCaptureSourceIdentitySignals(
  signals: LeadCaptureSourceIdentitySignals
): boolean {
  return signals.providerFormIds.length > 0 || Boolean(signals.parentUrlKey);
}

/**
 * Add a persisted `SourceLeadEvent.sourceCampaignId` as an identity candidate.
 *
 * Next-Gen stores either the provider funnel UUID or the canonical
 * `parentUrlKey` in that column, so it is tried first as a form id and used as
 * the page identity when the payload carries none. A route-key-shaped value
 * yields no page identity because it has no pathname.
 */
export function withLeadCaptureSourceCampaignIdFallback(
  signals: LeadCaptureSourceIdentitySignals,
  sourceCampaignId: string | null | undefined
): LeadCaptureSourceIdentitySignals {
  const candidate = trimOrNull(sourceCampaignId);
  if (!candidate) return signals;
  const fallbackUrl = signals.parentUrlKey
    ? null
    : normalizeLeadCaptureParentUrl(`https://${candidate}`);
  return {
    ...signals,
    providerFormIds: dedupe([candidate, ...signals.providerFormIds]),
    ...(fallbackUrl ? signalsFromParentUrl(fallbackUrl) : {}),
  };
}
