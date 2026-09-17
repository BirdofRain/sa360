import {
  GOOGLE_OAUTH_HTTP_TIMEOUT_MS,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
  type GoogleOAuthClientCredentials,
  type GoogleOAuthConfig,
} from "../../lib/google-oauth-env.js";

export type GoogleOAuthHttpFailure =
  | "invalid_grant"
  | "terminal_credential"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "malformed_response"
  | "rejected";

export type GoogleTokenExchange = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  tokenType: string;
};

export type GoogleIdentity = {
  googleUserId: string;
  email: string | null;
  displayName: string | null;
};

type FetchLike = typeof fetch;

async function boundedFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(GOOGLE_OAUTH_HTTP_TIMEOUT_MS),
  });
}

function classifyHttpFailure(status: number, oauthError?: unknown): GoogleOAuthHttpFailure {
  if (oauthError === "invalid_grant") return "invalid_grant";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status === 401 || status === 403) return "terminal_credential";
  return "rejected";
}

function parseScopes(value: unknown): string[] {
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

export async function exchangeGoogleAuthorizationCode(
  input: {
    code: string;
    codeVerifier: string;
    config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret" | "redirectUri">;
  },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; token: GoogleTokenExchange } | { ok: false; reason: GoogleOAuthHttpFailure }> {
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.config.redirectUri,
  });

  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }

  let json: Record<string, unknown>;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  if (!response.ok) {
    return { ok: false, reason: classifyHttpFailure(response.status, json.error) };
  }

  const accessToken =
    typeof json.access_token === "string" ? json.access_token.trim() : "";
  const refreshToken =
    typeof json.refresh_token === "string" ? json.refresh_token.trim() : "";
  const expiresIn =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in) && json.expires_in > 0
      ? json.expires_in
      : null;
  if (!accessToken || !refreshToken || !expiresIn) {
    return { ok: false, reason: "malformed_response" };
  }
  return {
    ok: true,
    token: {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: parseScopes(json.scope),
      tokenType:
        typeof json.token_type === "string" && json.token_type.trim()
          ? json.token_type.trim()
          : "Bearer",
    },
  };
}

export async function fetchGoogleIdentity(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; reason: GoogleOAuthHttpFailure }> {
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, GOOGLE_OAUTH_USERINFO_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }

  let json: Record<string, unknown>;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  if (!response.ok) {
    return { ok: false, reason: classifyHttpFailure(response.status) };
  }
  const sub = typeof json.sub === "string" ? json.sub.trim() : "";
  if (!sub) return { ok: false, reason: "malformed_response" };
  return {
    ok: true,
    identity: {
      googleUserId: sub,
      email: typeof json.email === "string" && json.email.trim() ? json.email.trim() : null,
      displayName:
        typeof json.name === "string" && json.name.trim() ? json.name.trim() : null,
    },
  };
}

export type GoogleRevokeOutcome =
  | { ok: true; result: "revoked" | "already_invalid" }
  | { ok: false; reason: "transient" | "rejected" };

export async function revokeGoogleToken(
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<GoogleRevokeOutcome> {
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, GOOGLE_OAUTH_REVOKE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    });
  } catch {
    return { ok: false, reason: "transient" };
  }
  if (response.ok) return { ok: true, result: "revoked" };
  if (response.status === 400) return { ok: true, result: "already_invalid" };
  if (response.status === 429 || response.status >= 500) {
    return { ok: false, reason: "transient" };
  }
  return { ok: false, reason: "rejected" };
}

export type GoogleTokenRefresh = {
  accessToken: string;
  /** Present only when Google rotates the refresh token. */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  tokenType: string;
};

export async function refreshGoogleAccessToken(
  input: {
    refreshToken: string;
    config: GoogleOAuthClientCredentials;
  },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; token: GoogleTokenRefresh } | { ok: false; reason: GoogleOAuthHttpFailure }> {
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }

  let json: Record<string, unknown>;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  if (!response.ok) {
    return { ok: false, reason: classifyHttpFailure(response.status, json.error) };
  }

  const accessToken =
    typeof json.access_token === "string" ? json.access_token.trim() : "";
  const replacementRefresh =
    typeof json.refresh_token === "string" && json.refresh_token.trim()
      ? json.refresh_token.trim()
      : null;
  const expiresIn =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in) && json.expires_in > 0
      ? json.expires_in
      : null;
  if (!accessToken || !expiresIn) {
    return { ok: false, reason: "malformed_response" };
  }
  return {
    ok: true,
    token: {
      accessToken,
      refreshToken: replacementRefresh,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: parseScopes(json.scope),
      tokenType:
        typeof json.token_type === "string" && json.token_type.trim()
          ? json.token_type.trim()
          : "Bearer",
    },
  };
}
