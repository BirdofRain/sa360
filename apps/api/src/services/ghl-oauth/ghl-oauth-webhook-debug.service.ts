/** In-memory latest GHL marketplace install webhook (safe fields only). */

export type GhlMarketplaceWebhookSafeSnapshot = {
  at: string;
  eventType: string | null;
  appIdPresent: boolean;
  versionIdPresent: boolean;
  installTypePresent: boolean;
  locationIdPresent: boolean;
  companyIdPresent: boolean;
  userIdPresent: boolean;
  timestampPresent: boolean;
  webhookIdPresent: boolean;
  handled: boolean;
  reconcileNote: string | null;
};

let latestWebhookDebug: GhlMarketplaceWebhookSafeSnapshot | null = null;

export function recordGhlMarketplaceWebhookDebug(snapshot: GhlMarketplaceWebhookSafeSnapshot): void {
  latestWebhookDebug = snapshot;
}

export function getLatestGhlMarketplaceWebhookDebug(): GhlMarketplaceWebhookSafeSnapshot | null {
  return latestWebhookDebug ? { ...latestWebhookDebug } : null;
}

export function clearGhlMarketplaceWebhookDebugForTests(): void {
  latestWebhookDebug = null;
}
