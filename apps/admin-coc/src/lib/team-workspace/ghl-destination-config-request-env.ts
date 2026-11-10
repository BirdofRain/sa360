/**
 * GoHighLevel configuration-request gate for Admin C.O.C.
 * Only trim() equal to the exact string "true" enables the request panel.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * This does not write ClientGhlDestination or arm delivery.
 */
export function isGhlDestinationConfigRequestEnabled(env?: {
  SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED?: string;
}): boolean {
  const value =
    env === undefined
      ? process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED
      : env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED;
  return value?.trim() === "true";
}
