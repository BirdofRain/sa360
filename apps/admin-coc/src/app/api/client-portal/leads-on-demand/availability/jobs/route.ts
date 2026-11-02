import { cookies } from "next/headers";

import { startPortalBuyerAvailabilityJob } from "@/lib/client-portal-api/server";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import {
  readCachedPortalMapSnapshot,
} from "@/lib/client-portal/portal-buyer-map";
import {
  isPortalInventoryMapEnabled,
  parsePortalInventoryAvailabilityQuery,
  projectPortalBuyerMapAvailability,
} from "@/lib/client-portal/portal-inventory-map";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const params = new URLSearchParams();
  if (typeof body.nicheKey === "string") params.set("nicheKey", body.nicheKey);
  if (typeof body.requestedAgeBucket === "string") {
    params.set("requestedAgeBucket", body.requestedAgeBucket);
  }
  if (body.requestedQuantity != null) params.set("requestedQuantity", String(body.requestedQuantity));
  const parsed = parsePortalInventoryAvailabilityQuery(params);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const cached = readCachedPortalMapSnapshot({
    clientAccountId: session.clientAccountId,
    nicheKey: parsed.value.nicheKey,
    requestedAgeBucket: parsed.value.requestedAgeBucket,
  });
  if (cached) {
    return Response.json({
      ok: true,
      status: "complete",
      availability: projectPortalBuyerMapAvailability({
        snapshot: cached,
        requestedQuantity: parsed.value.requestedQuantity,
      }),
    });
  }

  const started = await startPortalBuyerAvailabilityJob({
    clientAccountId: session.clientAccountId,
    nicheKey: parsed.value.nicheKey,
    commerceAgeBucketKey: parsed.value.requestedAgeBucket,
  });
  if (!started.ok) {
    return Response.json(
      { ok: false, error: "Availability is temporarily unavailable.", code: started.code },
      { status: started.status || 502 }
    );
  }
  return Response.json({ ok: true, status: "running", jobId: started.jobId });
}
