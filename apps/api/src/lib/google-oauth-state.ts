import { createHash, randomBytes } from "node:crypto";

const STATE_BYTES = 32;

/** RFC 7636 unreserved set; length 43–128. */
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]+$/;

export function hashGoogleOAuthState(rawState: string): string {
  return createHash("sha256").update(rawState, "utf8").digest("hex");
}

export function generateGoogleOAuthState(): { rawState: string; stateHash: string } {
  const rawState = randomBytes(STATE_BYTES).toString("base64url");
  return { rawState, stateHash: hashGoogleOAuthState(rawState) };
}

/**
 * RFC 7636 code_verifier: 32 random bytes as base64url (43 chars, unreserved alphabet).
 * Phase 1B can SHA-256 + base64url this value into an S256 code_challenge.
 */
export function generatePkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function createPkceS256Challenge(verifier: string): string {
  if (!isValidPkceVerifier(verifier)) throw new Error("Invalid PKCE verifier.");
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function isValidPkceVerifier(verifier: string): boolean {
  return (
    verifier.length >= 43 && verifier.length <= 128 && PKCE_VERIFIER_PATTERN.test(verifier)
  );
}
