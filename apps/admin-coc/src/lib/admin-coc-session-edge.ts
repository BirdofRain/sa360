/**
 * Edge-safe Admin C.O.C. session verification for Next.js middleware (Web Crypto).
 * HMAC + expiry only. Distinct from the customer portal verifier and secret.
 */

import {
  ADMIN_COC_LEGACY_SESSION_MARKER,
  ADMIN_COC_SESSION_SECRET_MIN_LENGTH,
  getAdminCocSessionSecret,
  isAdminCocPasswordConfigured,
} from "./admin-coc-auth.ts";

const SESSION_VERSION = "ac1";
const SESSION_TYP = "admin_coc";

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
    const parsed = JSON.parse(json) as { typ?: string; iat?: number; exp?: number };
    if (parsed.typ !== SESSION_TYP) return false;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") return false;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return false;
    if (parsed.exp <= nowSec) return false;
    return true;
  } catch {
    return false;
  }
}

function edgeSecretReady(): string | undefined {
  const secret = getAdminCocSessionSecret();
  if (!secret || secret.length < ADMIN_COC_SESSION_SECRET_MIN_LENGTH) return undefined;
  return secret;
}

/** Verify signed Admin C.O.C. cookie on the Edge middleware runtime. */
export async function verifyAdminCocSessionTokenEdge(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token?.trim() || token === ADMIN_COC_LEGACY_SESSION_MARKER) return false;
  const secret = edgeSecretReady();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, body, sig] = parts;
  if (version !== SESSION_VERSION || !body || !sig) return false;

  const signed = `${SESSION_VERSION}.${body}`;
  const expected = await signPayloadBase64Url(signed, secret);
  if (!timingSafeEqualStrings(sig, expected)) return false;
  return decodeSessionBody(body, nowSec);
}

/** Edge equivalent of `isAdminCocSessionAuthorized`. */
export async function isAdminCocSessionAuthorizedEdge(
  cookieValue: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!isAdminCocPasswordConfigured()) return true;
  return verifyAdminCocSessionTokenEdge(cookieValue, nowSec);
}
