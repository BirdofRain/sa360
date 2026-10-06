import { normalizeLeadCaptureParentUrl } from "./leadcapture-parent-url.js";
import {
  coerceLeadCaptureLeadIdValue,
  resolveLeadCaptureField,
} from "./leadcapture-payload-resolver.js";
import type { NextGenSourceIdentity } from "./leadcapture-nextgen-source-identity.js";

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve Legacy provider form/page identity without changing NextGen UUID semantics.
 * Native `lead_form` is the provider form ID; normalized parent URL is its stable page identity.
 */
export function resolveLegacyLeadCaptureSourceIdentity(
  raw: Record<string, unknown>,
  routeKey: string
): NextGenSourceIdentity {
  const providerFormId = coerceLeadCaptureLeadIdValue(
    resolveLeadCaptureField(raw, "lead_form")
  );
  const parent = normalizeLeadCaptureParentUrl(
    resolveLeadCaptureField(raw, "parent_url")
  );
  const sourceFunnelName =
    trimOrUndefined(resolveLeadCaptureField(raw, "funnel_name")) ??
    trimOrUndefined(resolveLeadCaptureField(raw, "form_name")) ??
    trimOrUndefined(resolveLeadCaptureField(raw, "campaign_name")) ??
    null;

  const stableSourceId = providerFormId ?? parent?.parentUrlKey ?? null;
  const stableSourceIdKind = providerFormId
    ? "form_id"
    : parent
      ? "parent_url_key"
      : "route_key";

  return {
    sourceCampaignId: stableSourceId ?? routeKey,
    sourceCampaignName: sourceFunnelName,
    sourceFunnelName,
    stableSourceId,
    stableSourceIdKind,
    parentUrlKey: parent?.parentUrlKey ?? null,
    pageSlug: parent?.pageSlug ?? null,
    routeKey,
    routeKeyIdentityMismatch: false,
  };
}
