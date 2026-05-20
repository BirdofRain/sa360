import { timingSafeEqual } from "node:crypto";

import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { isClientPortalLoginConfigured } from "./portal-auth.ts";
import {
  createPortalSessionToken,
  portalSessionCookieOptions,
  readPortalSessionCookie,
} from "./portal-session.ts";

/**
 * Temporary MVP invite link (`?access=`) — grants a real signed session when configured.
 * Replaced for day-to-day use by `/portal/login` (Phase 3).
 */

export const CLIENT_PORTAL_ACCESS_COOKIE = "sa360_client_portal_access";
export const CLIENT_PORTAL_ACCESS_SESSION_VALUE = "granted";
/** @deprecated Legacy marker; invite flow now sets `sa360_client_portal_session`. */
export const CLIENT_PORTAL_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type PortalRenderMode =
  | "mock"
  | "live"
  | "access_gate"
  | "login_required";

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

/** Server-only shared access code for temporary invite links. */
export function getClientPortalAccessCode(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_ACCESS_CODE?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Live API wiring is configured (Phase 2). */
export function isClientPortalLiveMode(): boolean {
  return isClientPortalApiConfigured();
}

/** Live portal requires a signed session before showing metrics or calling the BFF. */
export function isClientPortalSessionRequired(): boolean {
  return isClientPortalLiveMode();
}

/**
 * Legacy temporary gate UI: live API + access code, and login env not configured.
 * When login env is set, unauthenticated users go to `/portal/login` instead.
 */
export function isClientPortalAccessGateRequired(): boolean {
  return (
    isClientPortalLiveMode() &&
    !isClientPortalLoginConfigured() &&
    getClientPortalAccessCode() !== undefined
  );
}

export function isValidPortalAccessCode(provided: string): boolean {
  const expected = getClientPortalAccessCode();
  if (!expected || !provided) return false;
  return timingSafeStringEqual(provided.trim(), expected);
}

/** Phase 3 signed session cookie. */
export function hasPortalSession(cookieValue: string | undefined): boolean {
  return readPortalSessionCookie(cookieValue);
}

/** @deprecated Use `hasPortalSession`. Legacy access cookie from Phase 2.5. */
export function hasPortalAccessSession(cookieValue: string | undefined): boolean {
  return cookieValue === CLIENT_PORTAL_ACCESS_SESSION_VALUE;
}

/** Decides whether to show gate, login redirect, mock preview, or fetch live dashboard. */
export function resolvePortalRenderMode(opts: {
  apiConfigured: boolean;
  hasSession: boolean;
  loginConfigured: boolean;
  gateRequired: boolean;
}): PortalRenderMode {
  if (!opts.apiConfigured) return "mock";
  if (opts.hasSession) return "live";
  if (opts.loginConfigured) return "login_required";
  if (opts.gateRequired) return "access_gate";
  return "login_required";
}

/** Set signed session after valid login or invite `?access=` code. */
export function portalSignedSessionCookieOptions(): ReturnType<
  typeof portalSessionCookieOptions
> | null {
  const token = createPortalSessionToken();
  if (!token) return null;
  return portalSessionCookieOptions(token);
}

/** @deprecated Legacy access cookie — prefer `portalSignedSessionCookieOptions`. */
export function portalAccessCookieOptions(): {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    name: CLIENT_PORTAL_ACCESS_COOKIE,
    value: CLIENT_PORTAL_ACCESS_SESSION_VALUE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CLIENT_PORTAL_ACCESS_MAX_AGE_SECONDS,
  };
}

/** Build redirect target after ?access= succeeds (strip secret from URL). */
export function portalPathAfterAccessGrant(rangeKey: string): string {
  if (rangeKey === "7d") return "/portal";
  return `/portal?range=${encodeURIComponent(rangeKey)}`;
}

export function portalLoginPath(nextPath?: string): string {
  if (!nextPath || nextPath === "/portal") return "/portal/login";
  return `/portal/login?next=${encodeURIComponent(nextPath)}`;
}
