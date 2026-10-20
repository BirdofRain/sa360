/**
 * Customer portal live inventory and multi-bucket ordering.
 * Both default off. They do not change SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED.
 */

export function isPortalLiveInventoryEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_PORTAL_LIVE_INVENTORY_ENABLED === "true";
}

export function isPortalMultiBucketOrdersEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_PORTAL_MULTI_BUCKET_ORDERS_ENABLED === "true";
}
