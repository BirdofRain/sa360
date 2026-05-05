/**
 * Shared secret check for `x-sa360-secret` (GHL lifecycle webhooks, Synthflow voice routes).
 * Fail-closed: requires non-empty `WEBHOOK_SECRET` in env and a non-empty incoming value (no `undefined === undefined`).
 */
export function isValidWebhookSecret(secret?: string): boolean {
  const envRaw = process.env.WEBHOOK_SECRET;
  const env = typeof envRaw === "string" ? envRaw.trim() : "";
  const incoming = typeof secret === "string" ? secret.trim() : "";
  if (!env || !incoming) {
    return false;
  }
  return incoming === env;
}
