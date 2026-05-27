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
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
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

  return {
    masterClientAccountId: payload.client_account_id.trim(),
    campaignId: trimOrUndefined(attribution.campaign_id),
    campaignName: trimOrUndefined(attribution.campaign_name),
    adsetId: trimOrUndefined(attribution.adset_id),
    adId: trimOrUndefined(attribution.ad_id),
    formId: readRoutingField(routingRaw, ["form_id", "lead_form_id", "formId"]),
    utmCampaign: trimOrUndefined(attribution.utm_campaign),
    utmContent: trimOrUndefined(attribution.utm_content),
    sourcePlatform: trimOrUndefined(attribution.source_platform),
    sourceType: trimOrUndefined(attribution.source_type),
    nicheKey:
      trimOrUndefined(payload.routing?.niche_key) ??
      readRoutingField(routingRaw, ["niche_key", "nicheKey"]),
    productType: trimOrUndefined(payload.policy?.product_type),
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
