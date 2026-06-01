import { timingSafeEqual } from "node:crypto";

import {
  fetchPortalClientContext,
  type PortalClientContextResponse,
} from "../client-portal-api/server.ts";
import type { PortalSessionCreateInput } from "./portal-session.ts";

/**
 * Env-based shared portal password (MVP). Login email maps to ClientAccount via API.
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

export type PortalLoginAuthResult =
  | { ok: true; session: PortalSessionCreateInput }
  | { ok: false; error: string };

function contextToSession(
  ctx: PortalClientContextResponse,
  loginEmail: string
): PortalSessionCreateInput {
  return {
    clientAccountId: ctx.clientAccountId,
    clientDisplayName: ctx.clientDisplayName,
    portalDisplayName: ctx.portalDisplayName,
    portalLoginEmail: loginEmail,
  };
}

function envFallbackSession(loginEmail: string): PortalSessionCreateInput | null {
  const envAccountId = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID?.trim();
  const envEmail = getClientPortalLoginEmail();
  if (!envAccountId || !envEmail) return null;
  if (normalizePortalLoginEmail(loginEmail) !== normalizePortalLoginEmail(envEmail)) {
    return null;
  }
  const clientDisplayName =
    process.env.NEXT_PUBLIC_CLIENT_PORTAL_DISPLAY_NAME?.trim() ||
    process.env.CLIENT_PORTAL_DISPLAY_NAME?.trim() ||
    "Your business";
  return {
    clientAccountId: envAccountId,
    clientDisplayName,
    portalDisplayName: null,
    portalLoginEmail: loginEmail,
  };
}

/** Resolve tenant after password check: DB portalLoginEmail, then env fallback. */
export async function authenticatePortalLogin(
  email: string,
  password: string
): Promise<PortalLoginAuthResult> {
  if (!isClientPortalLoginConfigured()) {
    return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
  }
  if (!verifyClientPortalPassword(password)) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
  }

  const loginEmail = normalizePortalLoginEmail(email);
  if (!loginEmail) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
  }

  const ctxResult = await fetchPortalClientContext(loginEmail);
  if (ctxResult.ok) {
    const ctx = ctxResult.data;
    if (!ctx.portalEnabled) {
      return { ok: false, error: PORTAL_LOGIN_DISABLED };
    }
    return { ok: true, session: contextToSession(ctx, loginEmail) };
  }

  if (ctxResult.status === 404) {
    const fallback = envFallbackSession(loginEmail);
    if (fallback) {
      return { ok: true, session: fallback };
    }
    return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
  }

  const fallback = envFallbackSession(loginEmail);
  if (fallback) {
    return { ok: true, session: fallback };
  }

  return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
}
