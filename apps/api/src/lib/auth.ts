export function isValidWebhookSecret(secret?: string) {
  return secret === process.env.WEBHOOK_SECRET;
}