/**
 * Meta App Reviewer credential and session configuration.
 *
 * Separate from Admin C.O.C. operator login. The password verifier and signing
 * secret are server-only. Never read them from a NEXT_PUBLIC_ variable.
 *
 * SA360_META_REVIEWER_PASSWORD must be a scrypt verifier (same encoding as
 * portal passwords), not the plaintext password. Login fails closed when the
 * verifier or a usable signing secret is missing.
 *
 * Signing secret: SA360_META_REVIEWER_SESSION_SECRET when it is at least 16
 * characters. A dedicated secret that is set but too short fails closed and
 * does not fall back. When the dedicated secret is unset, sessions are signed
 * with ADMIN_COC_SESSION_SECRET so an operator can ship the password verifier
 * first. Set the dedicated secret in production so reviewer revocation does
 * not sign out operators.
 */

export const META_REVIEWER_ROLE = "meta_reviewer" as const;
export const META_REVIEWER_SESSION_COOKIE = "sa360_meta_reviewer_session";
/** 12 hours. Hard ceiling is 24 hours. */
export const META_REVIEWER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const META_REVIEWER_SESSION_ABSOLUTE_MAX_AGE_SECONDS = 60 * 60 * 24;
export const META_REVIEWER_SESSION_SECRET_MIN_LENGTH = 16;
export const META_REVIEWER_SIGN_IN_FAILED = "Sign-in failed.";

export function getMetaReviewerPasswordVerifier(): string | undefined {
  const raw = process.env.SA360_META_REVIEWER_PASSWORD?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * Usable HMAC secret, or undefined when reviewer sessions must not be issued
 * or accepted.
 */
export function getMetaReviewerSessionSecret(): string | undefined {
  const dedicated = process.env.SA360_META_REVIEWER_SESSION_SECRET?.trim() ?? "";
  if (dedicated.length > 0) {
    return dedicated.length >= META_REVIEWER_SESSION_SECRET_MIN_LENGTH ? dedicated : undefined;
  }
  const admin = process.env.ADMIN_COC_SESSION_SECRET?.trim() ?? "";
  return admin.length >= META_REVIEWER_SESSION_SECRET_MIN_LENGTH ? admin : undefined;
}

export function isMetaReviewerLoginConfigured(): boolean {
  const verifier = getMetaReviewerPasswordVerifier();
  if (!verifier?.startsWith("scrypt$")) return false;
  return getMetaReviewerSessionSecret() !== undefined;
}
