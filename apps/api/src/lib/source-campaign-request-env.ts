/**
 * Source and campaign request gate.
 *
 * Only trim() equal to the exact string "true" enables the API.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * The gate does not confirm a source, create a routing rule, or arm delivery.
 */
export function isSourceCampaignRequestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED?.trim() === "true";
}
