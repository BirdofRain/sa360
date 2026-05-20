import { timingSafeEqual } from "node:crypto";

import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";

/**
 * Temporary MVP gate for `/portal` before Phase 3 client login.
 * Remove or replace when `/portal/login` ships.
 */

export const CLIENT_PORTAL_ACCESS_COOKIE = "sa360_client_portal_access";
export const CLIENT_PORTAL_ACCESS_SESSION_VALUE = "granted";
/** 30 days — same convenience window as admin gate. */
export const CLIENT_PORTAL_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type PortalRenderMode = "mock" | "live" | "access_gate";

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

/** Server-only shared access code for temporary live portal protection. */
export function getClientPortalAccessCode(): string | undefined {
  const raw = process.env.CLIENT_PORTAL_ACCESS_CODE?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Live API wiring is configured (Phase 2). */
export function isClientPortalLiveMode(): boolean {
  return isClientPortalApiConfigured();
}

/**
 * Temporary gate: both live API key (admin-coc) and access code must be set.
 * Mock preview (no API key) never requires this gate.
 */
export function isClientPortalAccessGateRequired(): boolean {
  return isClientPortalLiveMode() && getClientPortalAccessCode() !== undefined;
}

export function isValidPortalAccessCode(provided: string): boolean {
  const expected = getClientPortalAccessCode();
  if (!expected || !provided) return false;
  return timingSafeStringEqual(provided.trim(), expected);
}

export function hasPortalAccessSession(cookieValue: string | undefined): boolean {
  return cookieValue === CLIENT_PORTAL_ACCESS_SESSION_VALUE;
}

/** Decides whether to show gate, mock preview, or fetch live dashboard. */
export function resolvePortalRenderMode(opts: {
  apiConfigured: boolean;
  gateRequired: boolean;
  hasAccess: boolean;
}): PortalRenderMode {
  if (!opts.apiConfigured) return "mock";
  if (opts.gateRequired && !opts.hasAccess) return "access_gate";
  return "live";
}

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
