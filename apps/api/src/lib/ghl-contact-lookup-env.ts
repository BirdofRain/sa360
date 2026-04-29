/**
 * GHL HighLevel API (LeadConnector) contact search for Synthflow fallback.
 * Defaults are staging-safe: lookup is off until explicitly enabled with credentials.
 */
function parseEnabledFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") {
    return false;
  }
  return ["true", "1", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

/** When true, after a local miss SA360 may call GHL POST /contacts/search. */
export function isGhlContactLookupEnabled(): boolean {
  return parseEnabledFlag(process.env.SYNTHFLOW_GHL_CONTACT_LOOKUP_ENABLED);
}

export function getGhlPrivateIntegrationToken(): string | undefined {
  const t = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  return t || undefined;
}

/** GHL Location ID (subaccount / location) used as `locationId` on contact search. */
export function getGhlLocationId(): string | undefined {
  const id = process.env.GHL_LOCATION_ID?.trim();
  return id || undefined;
}

export function getGhlApiBaseUrl(): string {
  const u = process.env.GHL_API_BASE_URL?.trim();
  if (u) {
    return u.replace(/\/+$/, "");
  }
  return "https://services.leadconnectorhq.com";
}

export function getGhlContactSearchTimeoutMs(): number {
  const n = Number(process.env.GHL_CONTACT_SEARCH_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) {
    return 10_000;
  }
  return Math.min(Math.floor(n), 30_000);
}

export function isGhlContactLookupConfigured(): boolean {
  return Boolean(getGhlPrivateIntegrationToken() && getGhlLocationId());
}
