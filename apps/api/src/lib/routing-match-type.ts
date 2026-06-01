export const ROUTING_MATCH_TYPES = [
  "campaign_id",
  "adset_id",
  "ad_id",
  "form_id_utm_campaign",
  "utm_campaign",
  "keyword_fallback",
] as const;

export type RoutingMatchType = (typeof ROUTING_MATCH_TYPES)[number];

export function isRoutingMatchType(value: string): value is RoutingMatchType {
  return (ROUTING_MATCH_TYPES as readonly string[]).includes(value);
}
