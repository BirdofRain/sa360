/**
 * Edge-safe session verification for Next.js middleware (Web Crypto).
 * Signing stays in `portal-session.ts` (Node server only).
 */

const SESSION_VERSION = "v1";

function getClientPortalSessionSecret(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_SESSION_SECRET?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

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

/** Verify signed session cookie on the Edge middleware runtime. */
export async function verifyPortalSessionTokenEdge(
  token: string | undefined
): Promise<boolean> {
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
  const expected = await signPayloadBase64Url(payload, secret);
  return timingSafeEqualStrings(sig, expected);
}
