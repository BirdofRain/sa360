/**
 * Temporary single-password gate for the internal admin dashboard.
 *
 * - Password lives in `ADMIN_COC_PASSWORD` (server-only env var).
 * - On successful login the server action sets the `sa360_admin_session`
 *   cookie (httpOnly, sameSite=lax) with a constant marker value. Anyone with
 *   the cookie can act; we accept that risk for now per the temporary spec.
 * - When `ADMIN_COC_PASSWORD` is empty or unset, the gate is bypassed entirely
 *   so local dev keeps working without extra env wiring.
 *
 * This is intentionally minimal. Replace with a real session/JWT layer when
 * Google OAuth / Auth.js lands.
 */

export const ADMIN_COC_SESSION_COOKIE = "sa360_admin_session";
export const ADMIN_COC_SESSION_VALUE = "ok";
/** 30 days. */
export const ADMIN_COC_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Reads the raw password from server-only env. Trimmed; empty string -> undefined. */
export function getAdminCocPassword(): string | undefined {
  const raw = process.env.ADMIN_COC_PASSWORD?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Returns true when the gate is configured. Local dev (unset) returns false. */
export function isAdminCocPasswordConfigured(): boolean {
  return getAdminCocPassword() !== undefined;
}
