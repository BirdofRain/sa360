/**
 * Beta portal password policy (invite accept / password set).
 *
 * Length-only. No uppercase / lowercase / digit / symbol composition rules.
 * Maximum caps hashing-endpoint abuse. Do not log rejected password contents.
 */

export const PORTAL_PASSWORD_MIN_LENGTH = 10;
export const PORTAL_PASSWORD_MAX_LENGTH = 128;

export const PORTAL_PASSWORD_POLICY_COPY =
  "Use 10 to 128 characters. Uppercase letters, numbers, and symbols are optional.";

export const PORTAL_PASSWORD_POLICY_ERROR = PORTAL_PASSWORD_POLICY_COPY;

export const PORTAL_PASSWORD_MISMATCH = "Passwords do not match.";

export const PORTAL_PASSWORD_RESET_GENERIC_SUCCESS =
  "If that email is associated with an eligible portal account, we'll send a password reset link.";

export type PortalPasswordPolicyResult =
  | { ok: true }
  | { ok: false; error: string };

export function evaluatePortalPasswordPolicy(
  password: string
): PortalPasswordPolicyResult {
  if (typeof password !== "string") {
    return { ok: false, error: PORTAL_PASSWORD_POLICY_ERROR };
  }
  if (password.length < PORTAL_PASSWORD_MIN_LENGTH || password.length > PORTAL_PASSWORD_MAX_LENGTH) {
    return { ok: false, error: PORTAL_PASSWORD_POLICY_ERROR };
  }
  return { ok: true };
}

/**
 * Trusted confirmation check for invite/reset password forms.
 * Compare before hashing or forwarding. Do not log either value.
 */
export function evaluatePortalPasswordConfirmation(
  password: string,
  confirmPassword: string
): PortalPasswordPolicyResult {
  if (typeof password !== "string" || typeof confirmPassword !== "string") {
    return { ok: false, error: PORTAL_PASSWORD_MISMATCH };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: PORTAL_PASSWORD_MISMATCH };
  }
  return evaluatePortalPasswordPolicy(password);
}
