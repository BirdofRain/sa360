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
