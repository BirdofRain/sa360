import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * High-entropy one-time portal invite tokens.
 *
 * Raw token: 32 cryptographically random bytes, base64url (~43 chars, 256 bits).
 * Stored digest: SHA-256 hex. Deterministic so outstanding invites can be looked
 * up by unique index. This is not a human password — do not store invite tokens
 * in the scrypt password format (that would prevent indexed lookup).
 *
 * The raw token is returned only at issuance. Never persist or log it.
 *
 * Expiry: {@link PORTAL_INVITE_TTL_MS} (48 hours).
 */

export const PORTAL_INVITE_TTL_MS = 48 * 60 * 60 * 1000;
export const PORTAL_INVITE_TOKEN_BYTES = 32;
export const PORTAL_INVITE_PATH_PREFIX = "/portal/invite/";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function generatePortalInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(PORTAL_INVITE_TOKEN_BYTES).toString("base64url");
  return { rawToken, tokenHash: hashPortalInviteToken(rawToken) };
}

export function hashPortalInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function isWellFormedPortalInviteToken(rawToken: string): boolean {
  return typeof rawToken === "string" && TOKEN_RE.test(rawToken);
}

export function portalInviteTokensEqual(leftHash: string, rightHash: string): boolean {
  try {
    const a = Buffer.from(leftHash, "utf8");
    const b = Buffer.from(rightHash, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function portalInvitePath(rawToken: string): string {
  return `${PORTAL_INVITE_PATH_PREFIX}${rawToken}`;
}
