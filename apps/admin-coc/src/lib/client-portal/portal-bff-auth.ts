import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { readTrustedPortalSession } from "./portal-auth.ts";

/**
 * BFF guard for `/api/client-portal/*` — browser never sends CLIENT_PORTAL_API_KEY.
 *
 * Authoritative revocation: HMAC + expiry, then ClientAccount.portalSessionEpoch
 * via GET /client/v1/portal-session-state. Fail closed (401) when that state
 * cannot be checked. Edge middleware only checks HMAC.
 *
 * Mock preview (no live API, no session cookie) still skips the guard — that is
 * not HMAC-as-trusted. A presented cookie without verifiable DB state is 401.
 */
export function portalBffHasBrowserTenantOverride(searchParams: URLSearchParams): boolean {
  return searchParams.has("clientAccountId");
}

export async function guardClientPortalBffSession(
  sessionCookieValue: string | undefined
): Promise<Response | null> {
  if (!isClientPortalApiConfigured() && !sessionCookieValue) return null;
  const trusted = await readTrustedPortalSession(sessionCookieValue);
  if (trusted) return null;
  return Response.json(
    { ok: false, error: "Sign in required" },
    { status: 401 }
  );
}
