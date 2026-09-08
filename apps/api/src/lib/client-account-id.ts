import { randomBytes } from "node:crypto";

/** Server-generated public-registration tenant id. Never accept this from the browser. */
export const PUBLIC_CLIENT_ACCOUNT_ID_PREFIX = "avl";
const RANDOM_BYTES = 10;

export function generatePublicClientAccountId(
  entropy: Buffer = randomBytes(RANDOM_BYTES)
): string {
  return `${PUBLIC_CLIENT_ACCOUNT_ID_PREFIX}${entropy.toString("hex")}`;
}

export function isGeneratedPublicClientAccountId(value: string): boolean {
  return /^avl[a-f0-9]{20}$/.test(value);
}
