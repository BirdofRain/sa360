/**
 * Signed httpOnly Meta App Reviewer session (Node).
 * Distinct cookie, version, and typ from Admin C.O.C. and portal sessions.
 * A reviewer token must never verify as an operator session.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  META_REVIEWER_ROLE,
  META_REVIEWER_SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  META_REVIEWER_SESSION_COOKIE,
  META_REVIEWER_SESSION_MAX_AGE_SECONDS,
  META_REVIEWER_SESSION_SECRET_MIN_LENGTH,
  getMetaReviewerSessionSecret,
} from "./meta-reviewer-auth.ts";

export const META_REVIEWER_SESSION_VERSION = "mr1";
export const META_REVIEWER_SESSION_TYP = "meta_reviewer";

export type MetaReviewerSessionPayload = {
  typ: typeof META_REVIEWER_SESSION_TYP;
  role: typeof META_REVIEWER_ROLE;
  iat: number;
  exp: number;
  jti: string;
};

export type MetaReviewerSessionCookieOptions = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

function usableSecret(secret: string | undefined): secret is string {
  return Boolean(secret && secret.length >= META_REVIEWER_SESSION_SECRET_MIN_LENGTH);
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

function decodeSessionBody(encoded: string, nowSec: number): MetaReviewerSessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      typ?: unknown;
      role?: unknown;
      iat?: unknown;
      exp?: unknown;
      jti?: unknown;
    };
    if (parsed.typ !== META_REVIEWER_SESSION_TYP || parsed.role !== META_REVIEWER_ROLE) return null;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") return null;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
    if (typeof parsed.jti !== "string" || parsed.jti.length < 16 || parsed.jti.length > 64) return null;
    const lifetime = parsed.exp - parsed.iat;
    if (lifetime <= 0 || lifetime > META_REVIEWER_SESSION_ABSOLUTE_MAX_AGE_SECONDS) return null;
    if (parsed.exp <= nowSec) return null;
    return {
      typ: META_REVIEWER_SESSION_TYP,
      role: META_REVIEWER_ROLE,
      iat: parsed.iat,
      exp: parsed.exp,
      jti: parsed.jti,
    };
  } catch {
    return null;
  }
}

export function createMetaReviewerSessionToken(
  nowSec = Math.floor(Date.now() / 1000),
  secret = getMetaReviewerSessionSecret(),
  jti = randomBytes(16).toString("base64url")
): string | null {
  if (!usableSecret(secret)) return null;
  const exp = nowSec + META_REVIEWER_SESSION_MAX_AGE_SECONDS;
  const claims = {
    typ: META_REVIEWER_SESSION_TYP,
    role: META_REVIEWER_ROLE,
    iat: nowSec,
    exp,
    jti,
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signed = `${META_REVIEWER_SESSION_VERSION}.${body}`;
  const sig = signPayload(signed, secret);
  return `${signed}.${sig}`;
}

export function parseMetaReviewerSessionToken(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  secret = getMetaReviewerSessionSecret()
): MetaReviewerSessionPayload | null {
  if (!token?.trim()) return null;
  if (!usableSecret(secret)) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, body, sig] = parts;
  if (version !== META_REVIEWER_SESSION_VERSION || !body || !sig) return null;

  const signed = `${META_REVIEWER_SESSION_VERSION}.${body}`;
  const expected = signPayload(signed, secret);
  if (!timingSafeSigEqual(sig, expected)) return null;
  return decodeSessionBody(body, nowSec);
}

export function metaReviewerSessionCookieOptions(token: string): MetaReviewerSessionCookieOptions {
  return {
    name: META_REVIEWER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: META_REVIEWER_SESSION_MAX_AGE_SECONDS,
  };
}

export function metaReviewerSessionCookieClearOptions(): MetaReviewerSessionCookieOptions {
  return {
    name: META_REVIEWER_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}
