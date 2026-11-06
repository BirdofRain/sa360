/**
 * Outbound custom webhook delivery. Default off.
 * Only `trim()` equal to the exact string "true" enables it.
 * `TRUE`, `1`, `yes`, and `on` stay off, matching
 * `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED`.
 * This module does not register an adapter or send HTTP.
 */
export function isCustomWebhookDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED?.trim() === "true";
}
