/**
 * Edge-safe session verification for Next.js middleware (Web Crypto).
 * Supports v1 (env tenant) and v2 (embedded tenant JSON).
 */

const SESSION_V1 = "v1";
const SESSION_V2 = "v2";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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

function decodeSessionBody(encoded: string): boolean {
  try {
    const parsed = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as {
      clientAccountId?: string;
    };
    return typeof parsed.clientAccountId === "string" && parsed.clientAccountId.trim().length > 0;
  } catch {
    return false;
  }
}

async function verifyV1(parts: string[], secret: string): Promise<boolean> {
  const [, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  const payload = `${SESSION_V1}.${expStr}`;
  const expected = await signPayloadBase64Url(payload, secret);
  if (!timingSafeEqualStrings(sig, expected)) return false;
  const envId = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID?.trim();
  return Boolean(envId);
}

async function verifyV2(parts: string[], secret: string): Promise<boolean> {
  const [, body, sig] = parts;
  if (!body || !sig) return false;
  const signed = `${SESSION_V2}.${body}`;
  const expected = await signPayloadBase64Url(signed, secret);
  if (!timingSafeEqualStrings(sig, expected)) return false;
  return decodeSessionBody(body);
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
  const [version] = parts;
  if (version === SESSION_V1) return verifyV1(parts, secret);
  if (version === SESSION_V2) return verifyV2(parts, secret);
  return false;
}
