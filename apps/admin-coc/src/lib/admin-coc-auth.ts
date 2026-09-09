/**
 * Temporary single-password gate for the internal Admin C.O.C.
 *
 * - Password lives in `ADMIN_COC_PASSWORD` (server-only env var).
 * - Sessions are HMAC-signed with a separate `ADMIN_COC_SESSION_SECRET`.
 *   Never reuse `CLIENT_PORTAL_SESSION_SECRET`.
 * - When `ADMIN_COC_PASSWORD` is empty or unset, the gate is bypassed so local
 *   development keeps working without extra env wiring.
 * - Production fail-closed: if the password is set but the session secret is
 *   missing or too short, no session is valid and login cannot issue a cookie.
 */

export const ADMIN_COC_SESSION_COOKIE = "sa360_admin_session";
/** 30 days. */
export const ADMIN_COC_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Reject trivially short secrets so rotation/misconfig cannot mint weak HMACs. */
export const ADMIN_COC_SESSION_SECRET_MIN_LENGTH = 16;

/** Legacy forgeable marker. Never accept this as a session. */
export const ADMIN_COC_LEGACY_SESSION_MARKER = "ok";

/** Reads the raw password from server-only env. Trimmed; empty string -> undefined. */
export function getAdminCocPassword(): string | undefined {
  const raw = process.env.ADMIN_COC_PASSWORD?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Returns true when the password gate is configured. Local dev (unset) returns false. */
export function isAdminCocPasswordConfigured(): boolean {
  return getAdminCocPassword() !== undefined;
}

export function getAdminCocSessionSecret(): string | undefined {
  const raw = process.env.ADMIN_COC_SESSION_SECRET?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

export function isAdminCocSessionSecretConfigured(): boolean {
  const secret = getAdminCocSessionSecret();
  return Boolean(secret && secret.length >= ADMIN_COC_SESSION_SECRET_MIN_LENGTH);
}

/** Password set AND a usable signing secret. Required to mint or verify sessions. */
export function isAdminCocSessionIssuanceReady(): boolean {
  return isAdminCocPasswordConfigured() && isAdminCocSessionSecretConfigured();
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * When the password gate is on but signing is not ready:
 * production (and every other env) fail closed — no forged marker, no unsigned cookie.
 * Local-dev bypass remains: leave `ADMIN_COC_PASSWORD` unset.
 */
export function isAdminCocSessionMisconfigured(): boolean {
  return isAdminCocPasswordConfigured() && !isAdminCocSessionSecretConfigured();
}
