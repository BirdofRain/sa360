/**
 * Signed httpOnly Admin C.O.C. session (Node).
 * Pattern matches the customer portal HMAC (v2-style body + SHA-256) but uses a
 * distinct token prefix and `ADMIN_COC_SESSION_SECRET` only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ADMIN_COC_LEGACY_SESSION_MARKER,
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_MAX_AGE_SECONDS,
  ADMIN_COC_SESSION_SECRET_MIN_LENGTH,
  getAdminCocSessionSecret,
  isAdminCocPasswordConfigured,
} from "./admin-coc-auth.ts";

export const ADMIN_COC_SESSION_VERSION = "ac1";
export const ADMIN_COC_SESSION_TYP = "admin_coc";

export type AdminCocSessionPayload = {
  typ: typeof ADMIN_COC_SESSION_TYP;
  iat: number;
  exp: number;
};

export type AdminCocSessionCookieOptions = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

function usableSecret(secret: string | undefined): secret is string {
  return Boolean(secret && secret.length >= ADMIN_COC_SESSION_SECRET_MIN_LENGTH);
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeSigEqual(sig: string, expected: string): boolean {
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function encodeSessionBody(body: AdminCocSessionPayload): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function decodeSessionBody(
  encoded: string,
  nowSec: number
): AdminCocSessionPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<AdminCocSessionPayload>;
    if (
      parsed.typ !== ADMIN_COC_SESSION_TYP ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.iat) ||
      !Number.isFinite(parsed.exp)
    ) {
      return null;
    }
    if (parsed.exp <= nowSec) return null;
    return { typ: ADMIN_COC_SESSION_TYP, iat: parsed.iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function createAdminCocSessionToken(
  nowSec = Math.floor(Date.now() / 1000),
  secret = getAdminCocSessionSecret()
): string | null {
  if (!usableSecret(secret)) return null;
  const exp = nowSec + ADMIN_COC_SESSION_MAX_AGE_SECONDS;
  const body = encodeSessionBody({
    typ: ADMIN_COC_SESSION_TYP,
    iat: nowSec,
    exp,
  });
  const signed = `${ADMIN_COC_SESSION_VERSION}.${body}`;
  const sig = signPayload(signed, secret);
  return `${signed}.${sig}`;
}

export function parseAdminCocSessionToken(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  secret = getAdminCocSessionSecret()
): AdminCocSessionPayload | null {
  if (!token?.trim() || token === ADMIN_COC_LEGACY_SESSION_MARKER) return null;
  if (!usableSecret(secret)) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, body, sig] = parts;
  if (version !== ADMIN_COC_SESSION_VERSION || !body || !sig) return null;

  const signed = `${ADMIN_COC_SESSION_VERSION}.${body}`;
  const expected = signPayload(signed, secret);
  if (!timingSafeSigEqual(sig, expected)) return null;

  return decodeSessionBody(body, nowSec);
}

export function verifyAdminCocSessionToken(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  secret = getAdminCocSessionSecret()
): boolean {
  return parseAdminCocSessionToken(token, nowSec, secret) !== null;
}

/**
 * Handler/middleware authorization. Does not inspect the request pathname —
 * `/login` being public must not authorize a privileged Server Action.
 *
 * Local-dev fail-open: password unset. Any other configuration fails closed
 * unless the cookie is a current HMAC for `ADMIN_COC_SESSION_SECRET`.
 */
export function isAdminCocSessionAuthorized(
  cookieValue: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!isAdminCocPasswordConfigured()) return true;
  return verifyAdminCocSessionToken(cookieValue, nowSec);
}

export function adminCocSessionCookieOptions(token: string): AdminCocSessionCookieOptions {
  return {
    name: ADMIN_COC_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COC_SESSION_MAX_AGE_SECONDS,
  };
}

export function adminCocSessionCookieClearOptions(): AdminCocSessionCookieOptions {
  return {
    name: ADMIN_COC_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

export const ADMIN_COC_SIGN_IN_REQUIRED = "Sign in required";
export const ADMIN_COC_SESSION_SECRET_REQUIRED =
  "Admin session signing is not configured. Set ADMIN_COC_SESSION_SECRET (server-only, min 16 characters).";
