import type { GhlLocationConnection } from "@prisma/client";
import {
  getGhlOAuthApiBaseUrl,
  getGhlOAuthAuthorizeBaseUrl,
  getGhlOAuthClientId,
  getGhlOAuthClientSecret,
  getGhlOAuthRedirectUri,
  getGhlOAuthScopesForAuthorize,
  getGhlOAuthVersionId,
} from "../../lib/ghl-oauth-env.js";
import { safeGhlOAuthErrorMessageFromBody } from "./ghl-oauth-callback-log.js";

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
  appId: string | null;
  tokenType: string | null;
  expiresIn: number | null;
};

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || !scope.trim()) return [];
  return scope.split(/\s+/).filter(Boolean);
}

function expiresAtFromResponse(expiresIn: unknown): Date {
  const sec = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 86_400;
  return new Date(Date.now() + sec * 1000);
}

const GHL_OAUTH_TOKEN_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
} as const;

function parseTokenExchangeResponse(
  res: Response,
  text: string,
  fallbackLocationId?: string
): GhlOAuthTokenExchangeOutcome {
  let json: GhlOAuthTokenResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as GhlOAuthTokenResponse) : null;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.access_token) {
    return {
      ok: false,
      httpStatus: res.status,
      errorMessage: safeGhlOAuthErrorMessageFromBody(res.status, text),
    };
  }

  if (!json.refresh_token) {
    return {
      ok: false,
      httpStatus: res.status,
      errorMessage: "GHL OAuth response missing refresh_token.",
    };
  }

  return {
    ok: true,
    result: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: expiresAtFromResponse(json.expires_in),
      scopes: parseScopes(json.scope),
      locationId:
        typeof json.locationId === "string"
          ? json.locationId.trim()
          : fallbackLocationId?.trim() ?? null,
      companyId: typeof json.companyId === "string" ? json.companyId.trim() : null,
      userId: typeof json.userId === "string" ? json.userId.trim() : null,
      userType: typeof json.userType === "string" ? json.userType.trim() : null,
      appId: typeof json.appId === "string" ? json.appId.trim() : null,
      tokenType: typeof json.token_type === "string" ? json.token_type.trim() : null,
      expiresIn:
        typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
          ? json.expires_in
          : null,
    },
  };
}

export type GhlOAuthTokenExchangeOutcome =
  | { ok: true; result: GhlOAuthExchangeResult }
  | { ok: false; httpStatus: number; errorMessage: string };

export async function exchangeGhlOAuthAuthorizationCodeDetailed(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlOAuthTokenExchangeOutcome> {
  const clientId = getGhlOAuthClientId();
  const clientSecret = getGhlOAuthClientSecret();
  const redirectUri = getGhlOAuthRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ok: false,
      httpStatus: 0,
      errorMessage: "GHL OAuth client credentials or redirect URI not configured.",
    };
  }

  const base = getGhlOAuthApiBaseUrl();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: code.trim(),
    redirect_uri: redirectUri,
  });

  const res = await fetchImpl(`${base}/oauth/token`, {
    method: "POST",
    headers: GHL_OAUTH_TOKEN_HEADERS,
    body,
  });

  const text = await res.text();
  return parseTokenExchangeResponse(res, text);
}

export async function exchangeGhlOAuthAuthorizationCode(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlOAuthExchangeResult> {
  const outcome = await exchangeGhlOAuthAuthorizationCodeDetailed(code, fetchImpl);
  if (!outcome.ok) {
    throw new Error(
      outcome.httpStatus > 0
        ? `GHL OAuth token exchange failed (HTTP ${outcome.httpStatus}).`
        : outcome.errorMessage
    );
  }
  return outcome.result;
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
    headers: GHL_OAUTH_TOKEN_HEADERS,
    body,
  });

  const text = await res.text();
  const outcome = parseTokenExchangeResponse(res, text, connection.locationId);
  if (!outcome.ok) {
    throw new Error(
      outcome.httpStatus > 0
        ? `GHL OAuth refresh failed (HTTP ${outcome.httpStatus}).`
        : outcome.errorMessage
    );
  }
  return outcome.result;
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
  const versionId = getGhlOAuthVersionId();
  if (versionId) params.set("version_id", versionId);
  // GHL marketplace expects scope with %20 between tokens (whitelabel install URL).
  return `${base}?${params.toString()}&scope=${encodeURIComponent(scopes)}`;
}
