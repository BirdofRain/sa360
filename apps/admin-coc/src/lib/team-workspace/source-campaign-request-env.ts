/**
 * Source and campaign request gate for Admin C.O.C.
 * Only trim() equal to the exact string "true" enables the panel and its actions.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * This does not confirm a source, create a routing rule, or arm delivery.
 */
export function isSourceCampaignRequestEnabled(env?: {
  SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED?: string;
}): boolean {
  const value =
    env === undefined
      ? process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED
      : env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED;
  return value?.trim() === "true";
}
