/**
 * Request-only client campaign registry gate.
 *
 * Only trim() equal to the exact string "true" enables the API.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * The gate does not confirm a source, create a routing rule, or arm delivery.
 */
export function isClientCampaignRegistryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED?.trim() === "true";
}
