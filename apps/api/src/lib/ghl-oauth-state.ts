import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGhlTokenEncryptionKey, isGhlTokenEncryptionConfigured } from "./ghl-token-encryption.js";

export type GhlOAuthStatePayload = {
  clientAccountId?: string;
  nonce: string;
  returnTo?: string;
  exp: number;
};

const STATE_TTL_MS = 15 * 60 * 1000;

function stateSigningKey(): Buffer {
  if (isGhlTokenEncryptionConfigured()) {
    return getGhlTokenEncryptionKey();
  }
  const fallback = process.env.ADMIN_API_KEY?.trim() || process.env.SA360_ADMIN_KEY?.trim();
  if (!fallback) {
    throw new Error("GHL_TOKEN_ENCRYPTION_KEY or ADMIN_API_KEY required for OAuth state signing.");
  }
  return Buffer.from(fallback, "utf8");
}

function signPayload(encoded: string): string {
  return createHmac("sha256", stateSigningKey()).update(encoded).digest("base64url");
}

export function createGhlOAuthState(input: {
  clientAccountId?: string | null;
  returnTo?: string | null;
  now?: number;
}): string {
  const payload: GhlOAuthStatePayload = {
    clientAccountId: input.clientAccountId?.trim() || undefined,
    nonce: randomBytes(16).toString("hex"),
    returnTo: input.returnTo?.trim() || undefined,
    exp: (input.now ?? Date.now()) + STATE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

export function verifyGhlOAuthState(state: string): GhlOAuthStatePayload {
  const trimmed = state.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) {
    throw new Error("Invalid OAuth state format.");
  }
  const encoded = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  const expected = signPayload(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("OAuth state signature invalid.");
  }
  let payload: GhlOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GhlOAuthStatePayload;
  } catch {
    throw new Error("OAuth state payload invalid.");
  }
  if (!payload.nonce || typeof payload.exp !== "number") {
    throw new Error("OAuth state payload incomplete.");
  }
  if (Date.now() > payload.exp) {
    throw new Error("OAuth state expired.");
  }
  return payload;
}
