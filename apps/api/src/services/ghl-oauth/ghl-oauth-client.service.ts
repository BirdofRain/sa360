import type { GhlLocationConnection } from "@prisma/client";
import {
  getGhlOAuthApiBaseUrl,
  getGhlOAuthAuthorizeBaseUrl,
  getGhlOAuthClientId,
  getGhlOAuthClientSecret,
  getGhlOAuthRedirectUri,
  getGhlOAuthScopesForAuthorize,
} from "../../lib/ghl-oauth-env.js";

export type GhlOAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  appId?: string;
};

export type GhlOAuthExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  locationId: string | null;
  companyId: string | null;
  userId: string | null;
  userType: string | null;
};

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || !scope.trim()) return [];
  return scope.split(/\s+/).filter(Boolean);
}

function expiresAtFromResponse(expiresIn: unknown): Date {
  const sec = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 86_400;
  return new Date(Date.now() + sec * 1000);
}

export async function exchangeGhlOAuthAuthorizationCode(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlOAuthExchangeResult> {
  const clientId = getGhlOAuthClientId();
  const clientSecret = getGhlOAuthClientSecret();
  const redirectUri = getGhlOAuthRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GHL OAuth client credentials or redirect URI not configured.");
  }

  const base = getGhlOAuthApiBaseUrl();
  const res = await fetchImpl(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: code.trim(),
      redirect_uri: redirectUri,
    }),
  });

  const text = await res.text();
  let json: GhlOAuthTokenResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as GhlOAuthTokenResponse) : null;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.access_token) {
    throw new Error(`GHL OAuth token exchange failed (HTTP ${res.status}).`);
  }

  if (!json.refresh_token) {
    throw new Error("GHL OAuth response missing refresh_token.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: expiresAtFromResponse(json.expires_in),
    scopes: parseScopes(json.scope),
    locationId: typeof json.locationId === "string" ? json.locationId.trim() : null,
    companyId: typeof json.companyId === "string" ? json.companyId.trim() : null,
    userId: typeof json.userId === "string" ? json.userId.trim() : null,
    userType: typeof json.userType === "string" ? json.userType.trim() : null,
  };
}

export async function refreshGhlOAuthTokens(
  connection: Pick<GhlLocationConnection, "refreshTokenEncrypted" | "locationId">,
  decryptRefresh: (encrypted: string) => string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlOAuthExchangeResult> {
  const clientId = getGhlOAuthClientId();
  const clientSecret = getGhlOAuthClientSecret();
  const redirectUri = getGhlOAuthRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GHL OAuth client credentials or redirect URI not configured.");
  }

  const refreshToken = decryptRefresh(connection.refreshTokenEncrypted);
  const base = getGhlOAuthApiBaseUrl();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: redirectUri,
  });

  const res = await fetchImpl(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  let json: GhlOAuthTokenResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as GhlOAuthTokenResponse) : null;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.access_token) {
    throw new Error(`GHL OAuth refresh failed (HTTP ${res.status}).`);
  }

  if (!json.refresh_token) {
    throw new Error("GHL OAuth refresh response missing refresh_token.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: expiresAtFromResponse(json.expires_in),
    scopes: parseScopes(json.scope),
    locationId:
      typeof json.locationId === "string"
        ? json.locationId.trim()
        : connection.locationId.trim(),
    companyId: typeof json.companyId === "string" ? json.companyId.trim() : null,
    userId: typeof json.userId === "string" ? json.userId.trim() : null,
    userType: typeof json.userType === "string" ? json.userType.trim() : null,
  };
}

export async function fetchGhlLocationName(
  locationId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const base = getGhlOAuthApiBaseUrl();
  const res = await fetchImpl(`${base}/locations/${encodeURIComponent(locationId.trim())}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as { location?: { name?: string }; name?: string };
    const name = json.location?.name ?? json.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export function buildGhlOAuthAuthorizeUrl(state: string): string {
  const clientId = getGhlOAuthClientId();
  const redirectUri = getGhlOAuthRedirectUri();
  const scopes = getGhlOAuthScopesForAuthorize();
  if (!clientId || !redirectUri) {
    throw new Error("GHL OAuth client ID or redirect URI not configured.");
  }
  if (!scopes) {
    throw new Error(
      "GHL_OAUTH_SCOPES is not configured. Set a non-empty space-separated scope list."
    );
  }
  const base = getGhlOAuthAuthorizeBaseUrl();
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    client_id: clientId,
    state,
  });
  // GHL marketplace expects scope with %20 between tokens (whitelabel install URL).
  return `${base}?${params.toString()}&scope=${encodeURIComponent(scopes)}`;
}
