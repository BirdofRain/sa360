/** Exact opt-in for internal successful-delivery notification. Default off. */
export const DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV = "SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED";

/**
 * Only trim() equal to the exact string "true" enables notification.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * This is stricter than SA360_GHL_ONGOING_DELIVERY_ENABLED, which lowercases
 * before compare, and stricter than parsers that accept 1, yes, and on.
 */
export function isDeliverySuccessNotifyEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED?.trim() === "true";
}
