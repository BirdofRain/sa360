import { createHash, randomBytes } from "node:crypto";

const STATE_BYTES = 32;

export function hashGoogleOAuthState(rawState: string): string {
  return createHash("sha256").update(rawState, "utf8").digest("hex");
}

export function generateGoogleOAuthState(): { rawState: string; stateHash: string } {
  const rawState = randomBytes(STATE_BYTES).toString("base64url");
  return { rawState, stateHash: hashGoogleOAuthState(rawState) };
}

export function generatePkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}
