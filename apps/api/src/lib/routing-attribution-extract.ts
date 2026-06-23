import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";

/** Normalized attribution inputs for the routing matcher (from lifecycle payload). */
export type RoutingAttributionInput = {
  masterClientAccountId: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adId?: string;
  formId?: string;
  utmCampaign?: string;
  utmContent?: string;
  sourcePlatform?: string;
  sourceType?: string;
  nicheKey?: string;
  productType?: string;
  masterDatasetId?: string;
};

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === "bigint") {
    return v.toString();
  }
  return undefined;
}

function readRoutingField(
  routing: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!routing) return undefined;
  for (const key of keys) {
    const v = trimOrUndefined(routing[key]);
    if (v) return v;
  }
  return undefined;
}

/** Build matcher input from a lifecycle payload or stored `payloadJson`. */
export function extractRoutingAttributionFromPayload(
  payload: LifecycleEventSchema
): RoutingAttributionInput {
  const attribution = payload.attribution ?? {};
  const routingRaw = payload.routing as Record<string, unknown> | undefined;
  const sourceIntake = routingRaw?.source_intake as
    | { sourceAttributes?: Record<string, unknown> }
    | undefined;
  const preserved = sourceIntake?.sourceAttributes;

  const preservedString = (key: string): string | undefined => {
    const value = preserved?.[key];
    return trimOrUndefined(value);
  };

  return {
    masterClientAccountId: payload.client_account_id.trim(),
    campaignId:
      trimOrUndefined(attribution.campaign_id) ?? preservedString("campaign_id"),
    campaignName:
      trimOrUndefined(attribution.campaign_name) ?? preservedString("campaign_name"),
    adsetId: trimOrUndefined(attribution.adset_id) ?? preservedString("adset_id"),
    adId: trimOrUndefined(attribution.ad_id) ?? preservedString("ad_id"),
    formId: readRoutingField(routingRaw, ["form_id", "lead_form_id", "formId"]),
    utmCampaign:
      trimOrUndefined(attribution.utm_campaign) ?? preservedString("utm_campaign"),
    utmContent: trimOrUndefined(attribution.utm_content),
    sourcePlatform:
      trimOrUndefined(attribution.source_platform) ?? preservedString("source_platform"),
    sourceType:
      trimOrUndefined(attribution.source_type) ?? preservedString("source_type"),
    nicheKey:
      trimOrUndefined(payload.routing?.niche_key) ??
      readRoutingField(routingRaw, ["niche_key", "nicheKey"]) ??
      preservedString("lead_type") ??
      preservedString("niche_key"),
    productType:
      trimOrUndefined(payload.policy?.product_type) ??
      trimOrUndefined(payload.routing?.product_type) ??
      readRoutingField(routingRaw, ["product_type", "productType"]) ??
      preservedString("product_type"),
    masterDatasetId:
      trimOrUndefined(payload.routing?.master_dataset_id) ??
      readRoutingField(routingRaw, ["master_dataset_id", "masterDatasetId"]),
  };
}

/** Lowercased haystack for keyword fallback matching. */
export function routingAttributionHaystack(input: RoutingAttributionInput): string {
  return [
    input.campaignName,
    input.utmCampaign,
    input.utmContent,
    input.campaignId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
