import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import { safeGhlOAuthErrorMessageFromBody } from "./ghl-oauth-callback-log.js";
import type { GhlOAuthExchangeResult, GhlOAuthTokenResponse } from "./ghl-oauth-client.service.js";

/**
 * Exchange a company/agency access token for a location-scoped token (GHL POST /oauth/locationToken).
 * Server-side only — never log tokens.
 */
export async function exchangeGhlLocationTokenFromCompanyAccessToken(
  input: {
    companyAccessToken: string;
    companyId: string;
    locationId: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; result: GhlOAuthExchangeResult } | { ok: false; errorMessage: string }> {
  const companyId = input.companyId.trim();
  const locationId = input.locationId.trim();
  if (!companyId || !locationId) {
    return { ok: false, errorMessage: "companyId and locationId are required for location token exchange." };
  }

  const base = getGhlOAuthApiBaseUrl();
  const res = await fetchImpl(`${base}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.companyAccessToken}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ companyId, locationId }),
  });

  const text = await res.text();
  let json: GhlOAuthTokenResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as GhlOAuthTokenResponse) : null;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.access_token) {
    return {
      ok: false,
      errorMessage: safeGhlOAuthErrorMessageFromBody(res.status, text),
    };
  }

  const expiresIn =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 86_400;

  return {
    ok: true,
    result: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? input.companyAccessToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes:
        typeof json.scope === "string"
          ? json.scope.split(/\s+/).filter(Boolean)
          : [],
      locationId:
        typeof json.locationId === "string" ? json.locationId.trim() : locationId,
      companyId: typeof json.companyId === "string" ? json.companyId.trim() : companyId,
      userId: typeof json.userId === "string" ? json.userId.trim() : null,
      userType: typeof json.userType === "string" ? json.userType.trim() : "Location",
      appId: typeof json.appId === "string" ? json.appId.trim() : null,
      tokenType: typeof json.token_type === "string" ? json.token_type.trim() : null,
      expiresIn,
    },
  };
}

export function shouldAttemptGhlLocationTokenConversion(userType: string | null): boolean {
  const ut = userType?.trim().toLowerCase();
  return ut === "company" || ut === "agency";
}
