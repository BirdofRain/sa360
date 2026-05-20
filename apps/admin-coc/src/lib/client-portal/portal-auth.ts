import { timingSafeEqual } from "node:crypto";

/**
 * Env-based single-client credentials for Phase 3 portal login (MVP).
 */

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

/** Email + password + session secret required for `/portal/login`. */
export function isClientPortalLoginConfigured(): boolean {
  return Boolean(
    getClientPortalLoginEmail() &&
      getClientPortalLoginPassword() &&
      process.env.CLIENT_PORTAL_SESSION_SECRET?.trim()
  );
}

export function verifyClientPortalCredentials(email: string, password: string): boolean {
  const expectedEmail = getClientPortalLoginEmail();
  const expectedPassword = getClientPortalLoginPassword();
  if (!expectedEmail || !expectedPassword) return false;
  if (!email || !password) return false;
  if (
    !timingSafeStringEqual(
      normalizePortalLoginEmail(email),
      normalizePortalLoginEmail(expectedEmail)
    )
  ) {
    return false;
  }
  return timingSafeStringEqual(password, expectedPassword);
}
