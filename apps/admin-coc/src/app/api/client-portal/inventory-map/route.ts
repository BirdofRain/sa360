import { cookies } from "next/headers";

import { fetchClientInventoryStateAvailability } from "@/lib/client-portal-api/server";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

/**
 * Advisory live inventory availability by state for the portal order map.
 * Read-only: tenant comes from the signed session, never from the browser.
 */
export async function GET(req: Request) {
  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = await guardClientPortalBffSession(sessionCookie);
  if (denied) return denied;

  const session = getPortalSession(sessionCookie);
  if (!session?.clientAccountId) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const url = new URL(req.url);
  const nicheKey = url.searchParams.get("nicheKey")?.trim() || undefined;
  const productType = url.searchParams.get("productType")?.trim() || undefined;

  const result = await fetchClientInventoryStateAvailability({
    clientAccountId: session.clientAccountId,
    nicheKey,
    productType,
  });
  if (!result.model) {
    return Response.json(
      { ok: false, error: "Live availability is unavailable right now." },
      { status: result.status >= 400 && result.status < 600 ? result.status : 502 }
    );
  }

  return Response.json(
    { ok: true, availability: result.model },
    { headers: { "Cache-Control": "no-store" } }
  );
}
