import { cookies } from "next/headers";

import { fetchClientPortalDashboard } from "@/lib/client-portal-api/server";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { parseClientPortalRange } from "@/lib/client-portal/range";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const store = await cookies();
  const denied = guardClientPortalBffSession(
    store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value
  );
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const range = parseClientPortalRange(searchParams.get("range") ?? undefined);

  const result = await fetchClientPortalDashboard({ range });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.body || "Client portal fetch failed" },
      { status: result.status || 502 }
    );
  }

  return Response.json(result.data);
}
