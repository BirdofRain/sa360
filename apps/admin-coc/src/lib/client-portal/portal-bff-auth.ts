import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { parsePortalSessionToken } from "./portal-session.ts";

/**
 * BFF guard for `/api/client-portal/*` — browser never sends CLIENT_PORTAL_API_KEY.
 */
export function guardClientPortalBffSession(
  sessionCookieValue: string | undefined
): Response | null {
  if (!isClientPortalApiConfigured()) return null;
  if (parsePortalSessionToken(sessionCookieValue)) return null;
  return Response.json(
    { ok: false, error: "Sign in required" },
    { status: 401 }
  );
}
