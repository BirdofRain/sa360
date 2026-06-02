import { timingSafeEqual } from "node:crypto";

/** Env-based shared portal password (MVP). Login email maps to ClientAccount via API. */

function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function normalizePortalLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getClientPortalLoginEmail(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_LOGIN_EMAIL?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

export function getClientPortalLoginPassword(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_LOGIN_PASSWORD?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Password + session secret required for `/portal/login`. */
export function isClientPortalLoginConfigured(): boolean {
  return Boolean(
    getClientPortalLoginPassword() && process.env.CLIENT_PORTAL_SESSION_SECRET?.trim()
  );
}

export function verifyClientPortalPassword(password: string): boolean {
  const expectedPassword = getClientPortalLoginPassword();
  if (!expectedPassword || !password) return false;
  return timingSafeStringEqual(password, expectedPassword);
}

/** @deprecated Use verifyClientPortalPassword + authenticatePortalLogin. */
export function verifyClientPortalCredentials(email: string, password: string): boolean {
  if (!verifyClientPortalPassword(password)) return false;
  const expectedEmail = getClientPortalLoginEmail();
  if (!expectedEmail) return false;
  return timingSafeStringEqual(
    normalizePortalLoginEmail(email),
    normalizePortalLoginEmail(expectedEmail)
  );
}

export const PORTAL_LOGIN_DISABLED =
  "Your portal is not enabled yet. Contact your account team.";
export const PORTAL_LOGIN_SETUP_ERROR =
  "Your portal sign-in is not set up yet. Contact your SA360 account team.";
export const PORTAL_LOGIN_INVALID_CREDENTIALS =
  "Email or password is incorrect. Please try again.";
