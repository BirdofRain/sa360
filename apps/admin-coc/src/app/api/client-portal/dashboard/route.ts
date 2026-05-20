import { cookies } from "next/headers";

import { fetchClientPortalDashboard } from "@/lib/client-portal-api/server";
import {
  hasPortalAccessSession,
  isClientPortalAccessGateRequired,
  portalAccessCookieOptions,
} from "@/lib/client-portal/access-gate";
import { parseClientPortalRange } from "@/lib/client-portal/range";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (isClientPortalAccessGateRequired()) {
    const store = await cookies();
    const session = store.get(portalAccessCookieOptions().name)?.value;
    if (!hasPortalAccessSession(session)) {
      return Response.json({ ok: false, error: "Portal access required" }, { status: 401 });
    }
  }

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
