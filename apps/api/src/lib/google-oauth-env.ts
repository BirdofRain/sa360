import { resolvePortalPublicBaseUrl } from "./portal-public-url.js";
import {
  parseSafePortalReturnTo,
  SAFE_PORTAL_RETURN_TO_DEFAULT,
} from "./safe-portal-return-to.js";

export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_OAUTH_HTTP_TIMEOUT_MS = 10_000;

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

export function isGoogleOAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_GOOGLE_OAUTH_ENABLED?.trim().toLowerCase() === "true";
}

export type GoogleOAuthClientCredentials = {
  clientId: string;
  clientSecret: string;
};

/** Client id/secret only — used for on-demand refresh. Independent of the OAuth enable flag. */
export function getGoogleOAuthClientCredentials(
  env: NodeJS.ProcessEnv = process.env
): GoogleOAuthClientCredentials | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  portalPublicBaseUrl: string;
};

/**
 * Google callback redirects may only target a configured http(s) origin.
 * Userinfo hosts (`https://portal.example@evil.example`), credentials, and
 * non-URL values fail closed so enablement cannot mint an open redirect.
 */
export function parseTrustedPortalPublicOrigin(
  raw: string | null | undefined
): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

export function getGoogleOAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const portalPublicBaseUrl = parseTrustedPortalPublicOrigin(resolvePortalPublicBaseUrl(env));
  if (!clientId || !clientSecret || !redirectUri || !portalPublicBaseUrl) return null;
  return { clientId, clientSecret, redirectUri, portalPublicBaseUrl };
}

export function buildGoogleOAuthAuthorizeUrl(input: {
  config: Pick<GoogleOAuthConfig, "clientId" | "redirectUri">;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function buildGooglePortalRedirect(
  portalPublicBaseUrl: string,
  returnTo: string,
  status: "connected" | "cancelled" | "error" | "account_in_use"
): string {
  const baseOrigin = parseTrustedPortalPublicOrigin(portalPublicBaseUrl);
  if (!baseOrigin) {
    throw new Error("Portal public base URL is invalid.");
  }
  const path = parseSafePortalReturnTo(returnTo) ?? SAFE_PORTAL_RETURN_TO_DEFAULT;
  const url = new URL(path, `${baseOrigin}/`);
  if (url.origin !== baseOrigin || !url.pathname.startsWith("/portal")) {
    const fallback = new URL(SAFE_PORTAL_RETURN_TO_DEFAULT, `${baseOrigin}/`);
    fallback.searchParams.set("google", status);
    return fallback.toString();
  }
  url.searchParams.set("google", status);
  return url.toString();
}
