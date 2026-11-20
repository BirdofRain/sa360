/**
 * Observational client-campaign shadow gate.
 *
 * Only trim() equal to the exact string "true" enables shadow writes.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * Off means intake does not read the campaign registry and does not write a shadow row.
 * The gate does not confirm a source, create a routing rule, post a tag, or arm delivery.
 */
export function isClientCampaignShadowResolutionEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED?.trim() === "true";
}
