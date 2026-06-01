import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed httpOnly session for the client portal.
 * v2 embeds tenant context; v1 (legacy) maps to env CLIENT_PORTAL_CLIENT_ACCOUNT_ID.
 */

import { CLIENT_PORTAL_SESSION_COOKIE } from "./portal-session-cookie.ts";

export { CLIENT_PORTAL_SESSION_COOKIE };
/** 30 days — aligned with temporary access gate and admin session convenience. */
export const CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_V1 = "v1";
const SESSION_V2 = "v2";

export type PortalSessionPayload = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string;
  iat: number;
  exp: number;
};

export type PortalSessionCreateInput = Omit<PortalSessionPayload, "iat" | "exp">;

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

function encodeSessionBody(body: PortalSessionPayload): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function decodeSessionBody(encoded: string): PortalSessionPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<PortalSessionPayload>;
    if (
      typeof parsed.clientAccountId !== "string" ||
      !parsed.clientAccountId.trim() ||
      typeof parsed.clientDisplayName !== "string" ||
      typeof parsed.portalLoginEmail !== "string" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      clientAccountId: parsed.clientAccountId.trim(),
      clientDisplayName: parsed.clientDisplayName,
      portalDisplayName:
        typeof parsed.portalDisplayName === "string" ? parsed.portalDisplayName : null,
      portalLoginEmail: parsed.portalLoginEmail,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/** Create a signed v2 session token. Returns null when secret is unset. */
export function createPortalSessionToken(
  input: PortalSessionCreateInput,
  nowSec = Math.floor(Date.now() / 1000)
): string | null {
  const secret = getClientPortalSessionSecret();
  if (!secret) return null;
  const exp = nowSec + CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS;
  const body = encodeSessionBody({ ...input, iat: nowSec, exp });
  const signed = `${SESSION_V2}.${body}`;
  const sig = signPayload(signed, secret);
  return `${signed}.${sig}`;
}

/** Legacy v1 token for env-only invite flows (no embedded tenant). */
export function createLegacyPortalSessionToken(
  nowSec = Math.floor(Date.now() / 1000)
): string | null {
  const secret = getClientPortalSessionSecret();
  if (!secret) return null;
  const exp = nowSec + CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_V1}.${exp}`;
  const sig = signPayload(payload, secret);
  return `${payload}.${sig}`;
}

function legacyEnvSessionPayload(exp: number): PortalSessionPayload | null {
  const clientAccountId = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID?.trim();
  if (!clientAccountId) return null;
  const portalLoginEmail = process.env.CLIENT_PORTAL_LOGIN_EMAIL?.trim() ?? "";
  const clientDisplayName =
    process.env.NEXT_PUBLIC_CLIENT_PORTAL_DISPLAY_NAME?.trim() ||
    process.env.CLIENT_PORTAL_DISPLAY_NAME?.trim() ||
    "Your business";
  return {
    clientAccountId,
    clientDisplayName,
    portalDisplayName: null,
    portalLoginEmail,
    iat: exp - CLIENT_PORTAL_SESSION_MAX_AGE_SECONDS,
    exp,
  };
}

function verifyV1Token(parts: string[], secret: string): PortalSessionPayload | null {
  const [, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  const payload = `${SESSION_V1}.${expStr}`;
  const expected = signPayload(payload, secret);
  if (!timingSafeSigEqual(sig, expected)) return null;
  return legacyEnvSessionPayload(exp);
}

function verifyV2Token(parts: string[], secret: string): PortalSessionPayload | null {
  const [, body, sig] = parts;
  if (!body || !sig) return null;
  const signed = `${SESSION_V2}.${body}`;
  const expected = signPayload(signed, secret);
  if (!timingSafeSigEqual(sig, expected)) return null;

  return decodeSessionBody(body);
}

/** Parse and verify session; returns payload or null. */
export function parsePortalSessionToken(token: string | undefined): PortalSessionPayload | null {
  if (!token?.trim()) return null;
  const secret = getClientPortalSessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version] = parts;
  if (version === SESSION_V1) return verifyV1Token(parts, secret);
  if (version === SESSION_V2) return verifyV2Token(parts, secret);
  return null;
}

/** Verify signature and expiry. */
export function verifyPortalSessionToken(token: string | undefined): boolean {
  return parsePortalSessionToken(token) !== null;
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

export function readPortalSessionCookie(
  cookieValue: string | undefined
): PortalSessionPayload | null {
  return parsePortalSessionToken(cookieValue);
}
