import { timingSafeEqual } from "node:crypto";

import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { isClientPortalSessionSigningConfigured } from "./portal-session.ts";

/** Env-based shared portal password (optional legacy fallback). Login email maps to ClientAccount via API. */

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

/** Session HMAC secret is present (required to issue/verify portal cookies). */
export function isClientPortalSessionConfigured(): boolean {
  return isClientPortalSessionSigningConfigured();
}

/** Optional legacy shared-password fallback is available. Not required for per-customer hashes. */
export function isClientPortalLegacyPasswordConfigured(): boolean {
  return Boolean(getClientPortalLoginPassword());
}

/**
 * Modern customer portal login readiness: session signing + portal API.
 * Does not require CLIENT_PORTAL_LOGIN_PASSWORD.
 */
export function isClientPortalLoginConfigured(): boolean {
  return isClientPortalSessionConfigured() && isClientPortalApiConfigured();
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
