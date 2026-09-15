import { resolvePortalPublicBaseUrl } from "./portal-public-url.js";

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

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  portalPublicBaseUrl: string;
};

export function getGoogleOAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const portalPublicBaseUrl = resolvePortalPublicBaseUrl(env);
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
  const url = new URL(returnTo, `${portalPublicBaseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("google", status);
  return url.toString();
}
