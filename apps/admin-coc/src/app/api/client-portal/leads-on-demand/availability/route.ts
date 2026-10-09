import { cookies } from "next/headers";

import { loadPortalInventoryAvailability } from "@/lib/client-portal-api/portal-inventory-availability";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import {
  buildPortalInventoryAvailability,
  isPortalInventoryMapEnabled,
  parsePortalInventoryAvailabilityQuery,
} from "@/lib/client-portal/portal-inventory-map";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isPortalInventoryMapEnabled()) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = await guardClientPortalBffSession(sessionCookie);
  if (denied) return denied;

  const session = getPortalSession(sessionCookie);
  if (!session?.clientAccountId) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const parsed = parsePortalInventoryAvailabilityQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await loadPortalInventoryAvailability({
    clientAccountId: session.clientAccountId,
    nicheKey: parsed.value.nicheKey,
    productType: parsed.value.productType,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.status }
    );
  }

  return Response.json(
    buildPortalInventoryAvailability({
      rows: result.availability.rows,
      evaluatedAt: result.availability.evaluatedAt,
      ...parsed.value,
    })
  );
}
