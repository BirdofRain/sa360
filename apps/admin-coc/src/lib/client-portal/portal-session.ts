import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed httpOnly session for the client portal (Phase 3).
 * Cookie value is never exposed to the browser as a secret — only a signed token.
 */

import { CLIENT_PORTAL_SESSION_COOKIE } from "./portal-session-cookie.ts";

export { CLIENT_PORTAL_SESSION_COOKIE };
/** 30 days — aligned with temporary access gate and admin session convenience. */
export const CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_VERSION = "v1";

export function getClientPortalSessionSecret(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_SESSION_SECRET?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

export function isClientPortalSessionSigningConfigured(): boolean {
  return getClientPortalSessionSecret() !== undefined;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Create a signed session token (`v1.<exp>.<sig>`). Returns null when secret is unset. */
export function createPortalSessionToken(
  nowSec = Math.floor(Date.now() / 1000)
): string | null {
  const secret = getClientPortalSessionSecret();
  if (!secret) return null;
  const exp = nowSec + CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VERSION}.${exp}`;
  const sig = signPayload(payload, secret);
  return `${payload}.${sig}`;
}

/** Verify signature and expiry. Safe for Edge middleware and server routes. */
export function verifyPortalSessionToken(token: string | undefined): boolean {
  if (!token?.trim()) return false;
  const secret = getClientPortalSessionSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expStr, sig] = parts;
  if (version !== SESSION_VERSION) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;

  const payload = `${version}.${expStr}`;
  const expected = signPayload(payload, secret);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function portalSessionCookieOptions(token: string): {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    name: CLIENT_PORTAL_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS,
  };
}

export function readPortalSessionCookie(cookieValue: string | undefined): boolean {
  return verifyPortalSessionToken(cookieValue);
}
