import { cookies } from "next/headers";

import { fetchClientPortalDashboard } from "@/lib/client-portal-api/server";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { parseClientPortalRange } from "@/lib/client-portal/range";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = guardClientPortalBffSession(sessionCookie);
  if (denied) return denied;

  const session = getPortalSession(sessionCookie);
  if (!session?.clientAccountId) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.has("clientAccountId")) {
    return Response.json(
      { ok: false, error: "clientAccountId cannot be supplied by the browser" },
      { status: 400 }
    );
  }

  const range = parseClientPortalRange(searchParams.get("range") ?? undefined);

  const result = await fetchClientPortalDashboard({
    range,
    clientAccountId: session.clientAccountId,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.body || "Client portal fetch failed" },
      { status: result.status || 502 }
    );
  }

  return Response.json(result.data);
}
