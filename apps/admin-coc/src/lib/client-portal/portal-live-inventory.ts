/**
 * Portal live inventory and multi-bucket ordering.
 * Both default off and do not change SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED
 * or SA360_PORTAL_INVENTORY_MAP_ENABLED.
 */

export function isPortalLiveInventoryEnabled(
  env?: { SA360_PORTAL_LIVE_INVENTORY_ENABLED?: string }
): boolean {
  const value =
    env === undefined
      ? process.env.SA360_PORTAL_LIVE_INVENTORY_ENABLED
      : env.SA360_PORTAL_LIVE_INVENTORY_ENABLED;
  return value === "true";
}

export function isPortalMultiBucketOrdersEnabled(
  env?: { SA360_PORTAL_MULTI_BUCKET_ORDERS_ENABLED?: string }
): boolean {
  const value =
    env === undefined
      ? process.env.SA360_PORTAL_MULTI_BUCKET_ORDERS_ENABLED
      : env.SA360_PORTAL_MULTI_BUCKET_ORDERS_ENABLED;
  return value === "true";
}
