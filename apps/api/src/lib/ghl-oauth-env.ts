/**
 * GHL Marketplace OAuth env (Phase 5A).
 *
 * Names only — never log secret values:
 * - GHL_OAUTH_CLIENT_ID
 * - GHL_OAUTH_CLIENT_SECRET
 * - GHL_OAUTH_REDIRECT_URI  → e.g. https://sa360-api-staging…/integrations/oauth/callback
 * - GHL_API_BASE_URL        → default https://services.leadconnectorhq.com
 * - GHL_TOKEN_ENCRYPTION_KEY
 * - GHL_OAUTH_AUTHORIZE_BASE_URL (optional; default marketplace chooselocation)
 * - ADMIN_COC_BASE_URL (optional; post-OAuth redirect to C.O.C.)
 */

export const GHL_OAUTH_DEFAULT_AUTHORIZE_BASE =
  "https://marketplace.leadconnectorhq.com/oauth/chooselocation";

export const GHL_OAUTH_DEFAULT_API_BASE = "https://services.leadconnectorhq.com";

export const GHL_OAUTH_DEFAULT_COC_RETURN_PATH = "/ghl-connections";

export function getGhlOAuthClientId(): string | undefined {
  return process.env.GHL_OAUTH_CLIENT_ID?.trim() || undefined;
}

export function getGhlOAuthClientSecret(): string | undefined {
  return process.env.GHL_OAUTH_CLIENT_SECRET?.trim() || undefined;
}

export function getGhlOAuthRedirectUri(): string | undefined {
  return process.env.GHL_OAUTH_REDIRECT_URI?.trim() || undefined;
}

export function getGhlOAuthApiBaseUrl(): string {
  const u = process.env.GHL_API_BASE_URL?.trim();
  if (u) return u.replace(/\/+$/, "");
  return GHL_OAUTH_DEFAULT_API_BASE;
}

export function getGhlOAuthAuthorizeBaseUrl(): string {
  const u = process.env.GHL_OAUTH_AUTHORIZE_BASE_URL?.trim();
  if (u) return u.replace(/\/+$/, "");
  return GHL_OAUTH_DEFAULT_AUTHORIZE_BASE;
}

export function getGhlOAuthScopes(): string | undefined {
  const s = process.env.GHL_OAUTH_SCOPES?.trim();
  return s || undefined;
}

export function getAdminCocBaseUrl(): string | undefined {
  const a = process.env.ADMIN_COC_BASE_URL?.trim();
  if (a) return a.replace(/\/+$/, "");
  const b = process.env.GHL_OAUTH_COC_REDIRECT_BASE?.trim();
  if (b) return b.replace(/\/+$/, "");
  return undefined;
}

export function isGhlOAuthConfigured(): boolean {
  return Boolean(
    getGhlOAuthClientId() &&
      getGhlOAuthClientSecret() &&
      getGhlOAuthRedirectUri() &&
      process.env.GHL_TOKEN_ENCRYPTION_KEY?.trim()
  );
}

export function buildCocRedirectUrl(returnToPath?: string | null): string {
  const base = getAdminCocBaseUrl();
  const path = returnToPath?.trim() || GHL_OAUTH_DEFAULT_COC_RETURN_PATH;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${base}${normalizedPath}`;
  return normalizedPath;
}
