import { createHash } from "node:crypto";

import { staffEnrollmentEnabled } from "./staff-enrollment.js";
import { STAFF_SIGN_IN_ORIGIN, STAFF_SIGN_IN_PATH } from "./staff-sign-in-url.js";

export { STAFF_SIGN_IN_ORIGIN, STAFF_SIGN_IN_PATH, STAFF_SIGN_IN_URL } from "./staff-sign-in-url.js";

/**
 * Dedicated Google staff OAuth client settings and the authorization-code
 * exchange. This module does not read the Drive or Sheets OAuth client and
 * does not verify ID tokens.
 */

export const STAFF_GOOGLE_SIGNIN_FLAG = "SA360_STAFF_GOOGLE_SIGNIN_ENABLED";
export const STAFF_GOOGLE_CLIENT_ID_ENV = "SA360_STAFF_GOOGLE_CLIENT_ID";
export const STAFF_GOOGLE_CLIENT_SECRET_ENV = "SA360_STAFF_GOOGLE_CLIENT_SECRET";
export const STAFF_GOOGLE_REDIRECT_URI_ENV = "SA360_STAFF_GOOGLE_REDIRECT_URI";
export const STAFF_GOOGLE_ENROLL_REDIRECT_URI_ENV = "SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI";

export const GOOGLE_ISSUER = "https://accounts.google.com";
export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
export const STAFF_GOOGLE_SCOPE = "openid email";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}\.apps\.googleusercontent\.com$/;
const CODE_PATTERN = /^[A-Za-z0-9_\-./]{8,512}$/;

export type StaffGoogleAudience = { clientId: string };

export type StaffGoogleBrowserConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function isStaffGoogleClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}

export function staffGoogleSignInEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STAFF_GOOGLE_SIGNIN_FLAG] === "true";
}

export function readStaffGoogleAudience(env: NodeJS.ProcessEnv = process.env): StaffGoogleAudience | null {
  if (!staffGoogleSignInEnabled(env)) return null;
  const clientId = readClientId(env[STAFF_GOOGLE_CLIENT_ID_ENV]);
  return clientId ? { clientId } : null;
}

export function readStaffGoogleBrowserConfig(env: NodeJS.ProcessEnv = process.env): StaffGoogleBrowserConfig | null {
  const audience = readStaffGoogleAudience(env);
  if (!audience) return null;
  const clientSecret = readClientSecret(env[STAFF_GOOGLE_CLIENT_SECRET_ENV]);
  const redirectUri = parseStaffGoogleRedirectUri(env[STAFF_GOOGLE_REDIRECT_URI_ENV]);
  if (!clientSecret || !redirectUri) return null;
  return { clientId: audience.clientId, clientSecret, redirectUri };
}

export function readStaffGoogleClientId(env: NodeJS.ProcessEnv = process.env): string | null {
  return readClientId(env[STAFF_GOOGLE_CLIENT_ID_ENV]);
}

export function readStaffGoogleEnrollmentBrowserConfig(env: NodeJS.ProcessEnv = process.env): StaffGoogleBrowserConfig | null {
  if (!staffEnrollmentEnabled(env)) return null;
  const clientId = readClientId(env[STAFF_GOOGLE_CLIENT_ID_ENV]);
  const clientSecret = readClientSecret(env[STAFF_GOOGLE_CLIENT_SECRET_ENV]);
  const redirectUri = parseStaffGoogleEnrollRedirectUri(env[STAFF_GOOGLE_ENROLL_REDIRECT_URI_ENV]);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function parseStaffGoogleRedirectUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length > 300) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/staff/google/callback") return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:") {
    if (!localhost) return null;
  } else if (url.protocol !== "https:") {
    return null;
  }
  return url.origin + url.pathname === trimmed ? trimmed : null;
}

export function parseStaffGoogleEnrollRedirectUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length > 300) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/staff/google/enroll/callback") return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:") {
    if (!localhost) return null;
  } else if (url.protocol !== "https:") {
    return null;
  }
  return url.origin + url.pathname === trimmed ? trimmed : null;
}

export function staffGoogleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", STAFF_GOOGLE_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function staffGoogleCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export async function exchangeStaffGoogleCode(input: {
  code: string;
  verifier: string;
  config: StaffGoogleBrowserConfig;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; idToken: string } | { ok: false; code: "exchange_failed" }> {
  if (!CODE_PATTERN.test(input.code) || !/^[A-Za-z0-9_-]{43,128}$/.test(input.verifier)) {
    return { ok: false, code: "exchange_failed" };
  }
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    redirect_uri: input.config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.verifier,
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, code: "exchange_failed" };
  }
  if (!response.ok) return { ok: false, code: "exchange_failed" };
  const text = await response.text();
  if (text.length > 20_000) return { ok: false, code: "exchange_failed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "exchange_failed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, code: "exchange_failed" };
  const record = parsed as Record<string, unknown>;
  if (typeof record.id_token !== "string" || record.id_token.split(".").length !== 3) {
    return { ok: false, code: "exchange_failed" };
  }
  return { ok: true, idToken: record.id_token };
}

/**
 * Invitation sign-in link. The path is fixed. Query strings, fragments, and
 * public hosts other than the branded origin are rejected. Localhost is
 * accepted only for local tests.
 */
export function parseStaffSignInUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length === 0 || trimmed.length > 300) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== STAFF_SIGN_IN_PATH) return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (localhost) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`;
  }
  if (url.protocol !== "https:" || url.origin !== STAFF_SIGN_IN_ORIGIN) return null;
  return `${STAFF_SIGN_IN_ORIGIN}${STAFF_SIGN_IN_PATH}`;
}

export function readStaffApiOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300 || value.trim() !== value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && !localhost) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin;
}

function readClientId(value: unknown): string | null {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value) ? value : null;
}

function readClientSecret(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 16 || value.length > 512 || /\s/u.test(value)) return null;
  return value;
}
