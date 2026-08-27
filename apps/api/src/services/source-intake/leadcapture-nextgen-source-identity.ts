import { isLeadCaptureUuidLeadId } from "../../lib/leadcapture-lead-id.js";

/**
 * NextGen campaign / source identity.
 *
 * The immutable LeadCapture funnel/form ID is the source of truth.
 * A copied stale sa360_route_key is compatibility metadata only.
 */

export type NextGenSourceIdentity = {
  sourceCampaignId: string;
  sourceCampaignName: string | null;
  sourceFunnelName: string | null;
  stableSourceId: string | null;
  stableSourceIdKind: "funnel_id" | "form_id" | "sa360_form_id" | "campaign_id" | "route_key";
  routeKey: string;
  routeKeyIdentityMismatch: boolean;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const GENERIC_ROUTE_TOKENS = new Set([
  "lcio",
  "legacy",
  "ng",
  "nextgen",
  "vet",
  "nurse",
  "mortgage",
  "trucker",
  "health",
  "life",
  "fex",
  "v2",
  "v3",
  "test",
  "unknown",
  "route",
  "canary",
]);

function normalizeComparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function distinctiveLeadCaptureRouteKeyTokens(routeKey: string): string[] {
  return routeKey
    .split(/[_\s-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !GENERIC_ROUTE_TOKENS.has(token) && !/^\d+$/.test(token));
}

function isRouteKeyShapedCampaignId(campaignId: string, routeKey: string): boolean {
  if (campaignId === routeKey) return true;
  const upper = campaignId.toUpperCase();
  return upper.startsWith("LCIO_") || upper.startsWith("LC_");
}

function readNestedId(raw: Record<string, unknown>, key: string): string | undefined {
  const answers = asRecord(raw.answers);
  return trimOrUndefined(raw[key]) ?? trimOrUndefined(answers?.[key]);
}

export function resolveNextGenStableSourceId(raw: Record<string, unknown>): {
  id: string;
  kind: "funnel_id" | "form_id" | "sa360_form_id";
} | null {
  const funnelId = readNestedId(raw, "funnel_id");
  if (funnelId) return { id: funnelId, kind: "funnel_id" };
  const formId = readNestedId(raw, "form_id");
  if (formId) return { id: formId, kind: "form_id" };
  const sa360FormId = readNestedId(raw, "sa360_form_id");
  if (sa360FormId) return { id: sa360FormId, kind: "sa360_form_id" };
  return null;
}

export function resolveNextGenSourceName(raw: Record<string, unknown>): {
  sourceName: string | null;
  funnelName: string | null;
} {
  const funnelName =
    readNestedId(raw, "funnel_name") ??
    readNestedId(raw, "sa360_funnel_name") ??
    readNestedId(raw, "form_name") ??
    null;
  const campaignName =
    readNestedId(raw, "campaign_name") ?? readNestedId(raw, "sa360_campaign_name") ?? null;
  return {
    sourceName: funnelName ?? campaignName ?? null,
    funnelName,
  };
}

export function detectNextGenRouteKeyIdentityMismatch(input: {
  stableSourceId: string | null;
  sourceName: string | null;
  routeKey: string;
}): boolean {
  const routeKey = input.routeKey.trim();
  if (!input.stableSourceId) return false;
  if (!routeKey || routeKey === "UNKNOWN_ROUTE") return false;
  if (routeKey === input.stableSourceId) return false;

  const tokens = distinctiveLeadCaptureRouteKeyTokens(routeKey);
  if (tokens.length === 0) return false;

  const name = normalizeComparable(input.sourceName ?? "");
  if (!name) return true;
  return tokens.some((token) => !name.includes(token));
}

/**
 * Resolve the stable NextGen campaign/source identifier.
 *
 * Precedence:
 * 1. funnel_id
 * 2. form_id
 * 3. sa360_form_id
 * 4. explicit campaign_id when it is actual LeadCapture source identity
 *    (UUID, and not merely a copied route key)
 * 5. route key as last-resort compatibility metadata
 */
export function resolveNextGenSourceIdentity(
  raw: Record<string, unknown>,
  routeKey: string
): NextGenSourceIdentity {
  const names = resolveNextGenSourceName(raw);
  const stable = resolveNextGenStableSourceId(raw);
  const explicitCampaignId =
    trimOrUndefined(raw.campaign_id) ?? trimOrUndefined(raw.sa360_campaign_id);

  let sourceCampaignId: string;
  let stableSourceIdKind: NextGenSourceIdentity["stableSourceIdKind"];

  if (stable) {
    sourceCampaignId = stable.id;
    stableSourceIdKind = stable.kind;
  } else if (
    explicitCampaignId &&
    isLeadCaptureUuidLeadId(explicitCampaignId) &&
    !isRouteKeyShapedCampaignId(explicitCampaignId, routeKey)
  ) {
    sourceCampaignId = explicitCampaignId;
    stableSourceIdKind = "campaign_id";
  } else {
    sourceCampaignId = routeKey;
    stableSourceIdKind = "route_key";
  }

  const stableSourceId = stable?.id ?? (stableSourceIdKind === "campaign_id" ? sourceCampaignId : null);

  return {
    sourceCampaignId,
    sourceCampaignName: names.sourceName,
    sourceFunnelName: names.funnelName ?? names.sourceName,
    stableSourceId,
    stableSourceIdKind,
    routeKey,
    routeKeyIdentityMismatch: detectNextGenRouteKeyIdentityMismatch({
      stableSourceId,
      sourceName: names.sourceName,
      routeKey,
    }),
  };
}
