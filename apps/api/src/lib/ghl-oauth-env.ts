/**
 * GHL Marketplace OAuth env (Phase 5A).
 *
 * Names only — never log secret values:
 * - GHL_OAUTH_CLIENT_ID
 * - GHL_OAUTH_CLIENT_SECRET
 * - GHL_OAUTH_REDIRECT_URI  → e.g. https://sa360-api-staging…/integrations/oauth/callback
 * - GHL_API_BASE_URL        → default https://services.leadconnectorhq.com
 * - GHL_TOKEN_ENCRYPTION_KEY
 * - GHL_OAUTH_AUTHORIZE_BASE_URL (optional; default marketplace v2 chooselocation)
 * - GHL_OAUTH_SCOPES (required for install; space-separated scope list)
 * - GHL_OAUTH_VERSION_ID (optional; marketplace app version_id for chooselocation)
 * - ADMIN_COC_BASE_URL (optional; post-OAuth redirect to C.O.C.)
 */

export const GHL_OAUTH_DEFAULT_AUTHORIZE_BASE =
  "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation";

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

export function getGhlOAuthVersionId(): string | undefined {
  const v = process.env.GHL_OAUTH_VERSION_ID?.trim();
  return v || undefined;
}

/** Normalized scope string for authorize URL (single spaces, non-empty). */
export function getGhlOAuthScopesForAuthorize(): string | undefined {
  const raw = getGhlOAuthScopes();
  if (!raw) return undefined;
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized || undefined;
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
      getGhlOAuthScopesForAuthorize() &&
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

export type GhlOAuthCallbackErrorReason =
  | "missing_code_or_state"
  | "state_missing"
  | "state_invalid"
  | "token_exchange_failed"
  | "storage_failed"
  | "missing_location";

export type GhlOAuthStartConfigDebug = {
  hasClientId: boolean;
  hasRedirectUri: boolean;
  hasScopes: boolean;
  hasVersionId: boolean;
  authorizeUrlIncludesVersionId: boolean;
};

export function getGhlOAuthStartConfigDebug(authorizeUrl?: string): GhlOAuthStartConfigDebug {
  const hasVersionId = Boolean(getGhlOAuthVersionId());
  let authorizeUrlIncludesVersionId = false;
  if (authorizeUrl) {
    try {
      authorizeUrlIncludesVersionId = new URL(authorizeUrl).searchParams.has("version_id");
    } catch {
      authorizeUrlIncludesVersionId = false;
    }
  }
  return {
    hasClientId: Boolean(getGhlOAuthClientId()),
    hasRedirectUri: Boolean(getGhlOAuthRedirectUri()),
    hasScopes: Boolean(getGhlOAuthScopesForAuthorize()),
    hasVersionId,
    authorizeUrlIncludesVersionId,
  };
}

export function buildCocOAuthErrorRedirect(
  reason: GhlOAuthCallbackErrorReason,
  returnTo?: string | null
): string {
  const base = buildCocRedirectUrl(returnTo);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}ghl_oauth=error&reason=${reason}`;
}

export function buildCocOAuthSuccessRedirect(
  status: "connected" | "connected_unlinked",
  locationId: string,
  returnTo?: string | null
): string {
  const base = buildCocRedirectUrl(returnTo);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}ghl_oauth=${status}&locationId=${encodeURIComponent(locationId)}`;
}
