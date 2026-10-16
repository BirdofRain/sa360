import "server-only";

import { isMetaReviewEnabled } from "./meta-review/config.ts";
import {
  getMetaReviewerPasswordVerifier,
  getMetaReviewerSessionSecret,
} from "./meta-reviewer-auth.ts";
import { verifyMetaReviewerPassword } from "./meta-reviewer-password.ts";
import { createMetaReviewerSessionToken } from "./meta-reviewer-session.ts";

/**
 * Mint a reviewer session token or return null.
 * Null covers a missing verifier, a plaintext password in config, a missing
 * signing secret, a disabled workspace, and a wrong password. Callers must
 * show one generic error.
 */
export async function issueMetaReviewerSessionToken(password: string): Promise<string | null> {
  if (!isMetaReviewEnabled()) return null;
  const verifier = getMetaReviewerPasswordVerifier();
  const secret = getMetaReviewerSessionSecret();
  if (!verifier || !secret) return null;
  const matches = await verifyMetaReviewerPassword(password, verifier);
  if (!matches) return null;
  return createMetaReviewerSessionToken(undefined, secret);
}
