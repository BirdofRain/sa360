import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { readTrustedPortalSession } from "./portal-auth.ts";
import { parsePortalSessionToken } from "./portal-session.ts";

/**
 * BFF guard for `/api/client-portal/*` — browser never sends CLIENT_PORTAL_API_KEY.
 *
 * Authoritative revocation: HMAC + expiry, then ClientAccount.portalSessionEpoch
 * via GET /client/v1/portal-session-state. Edge middleware only checks HMAC.
 */
export function portalBffHasBrowserTenantOverride(searchParams: URLSearchParams): boolean {
  return searchParams.has("clientAccountId");
}

export async function guardClientPortalBffSession(
  sessionCookieValue: string | undefined
): Promise<Response | null> {
  if (!isClientPortalApiConfigured()) return null;
  if (!parsePortalSessionToken(sessionCookieValue)) {
    return Response.json(
      { ok: false, error: "Sign in required" },
      { status: 401 }
    );
  }
  const trusted = await readTrustedPortalSession(sessionCookieValue);
  if (trusted) return null;
  return Response.json(
    { ok: false, error: "Sign in required" },
    { status: 401 }
  );
}
