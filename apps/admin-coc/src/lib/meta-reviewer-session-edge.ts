/**
 * Edge-safe Meta App Reviewer session verification for Next.js middleware.
 * Distinct cookie secret resolution, version, and typ from Admin C.O.C.
 */

import {
  META_REVIEWER_ROLE,
  META_REVIEWER_SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  META_REVIEWER_SESSION_SECRET_MIN_LENGTH,
  getMetaReviewerSessionSecret,
} from "./meta-reviewer-auth.ts";

const SESSION_VERSION = "mr1";
const SESSION_TYP = "meta_reviewer";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayloadBase64Url(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodeSessionBody(encoded: string, nowSec: number): boolean {
  try {
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as {
      typ?: unknown;
      role?: unknown;
      iat?: unknown;
      exp?: unknown;
      jti?: unknown;
    };
    if (parsed.typ !== SESSION_TYP || parsed.role !== META_REVIEWER_ROLE) return false;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") return false;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return false;
    if (typeof parsed.jti !== "string" || parsed.jti.length < 16 || parsed.jti.length > 64) return false;
    const lifetime = parsed.exp - parsed.iat;
    if (lifetime <= 0 || lifetime > META_REVIEWER_SESSION_ABSOLUTE_MAX_AGE_SECONDS) return false;
    if (parsed.exp <= nowSec) return false;
    return true;
  } catch {
    return false;
  }
}

export async function verifyMetaReviewerSessionTokenEdge(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token?.trim()) return false;
  const secret = getMetaReviewerSessionSecret();
  if (!secret || secret.length < META_REVIEWER_SESSION_SECRET_MIN_LENGTH) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, body, sig] = parts;
  if (version !== SESSION_VERSION || !body || !sig) return false;

  const signed = `${SESSION_VERSION}.${body}`;
  const expected = await signPayloadBase64Url(signed, secret);
  if (!timingSafeEqualStrings(sig, expected)) return false;
  return decodeSessionBody(body, nowSec);
}
