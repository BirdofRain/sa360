import { cookies } from "next/headers";

import {
  cancelPortalBuyerAvailabilityJob,
  readPortalBuyerAvailabilityJob,
} from "@/lib/client-portal-api/server";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { sameCanonicalStateSet } from "@/lib/client-portal/portal-buyer-availability-cache";
import { storePortalMapSnapshot } from "@/lib/client-portal/portal-buyer-map";
import {
  PORTAL_BUYER_AVAILABILITY_POLICY,
  isPortalInventoryMapEnabled,
  parsePortalInventoryAvailabilityQuery,
  portalBuyerMapUnavailable,
  projectPortalBuyerMapAvailability,
} from "@/lib/client-portal/portal-inventory-map";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

async function authorizedAccount(): Promise<
  | { ok: true; clientAccountId: string }
  | { ok: false; response: Response }
> {
  if (!isPortalInventoryMapEnabled()) {
    return { ok: false, response: Response.json({ ok: false, error: "Not found" }, { status: 404 }) };
  }
  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = await guardClientPortalBffSession(sessionCookie);
  if (denied) return { ok: false, response: denied };
  const session = getPortalSession(sessionCookie);
  if (!session?.clientAccountId) {
    return {
      ok: false,
      response: Response.json({ ok: false, error: "Sign in required" }, { status: 401 }),
    };
  }
  return { ok: true, clientAccountId: session.clientAccountId };
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizedAccount();
  if (!auth.ok) return auth.response;
  const { jobId } = await context.params;
  const parsed = parsePortalInventoryAvailabilityQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const job = await readPortalBuyerAvailabilityJob({
    clientAccountId: auth.clientAccountId,
    jobId,
    commerceAgeBucketKey: parsed.value.requestedAgeBucket,
  });
  if (!job.ok) {
    return Response.json(
      { ok: false, error: "Availability is temporarily unavailable." },
      { status: job.status || 502 }
    );
  }
  if (job.status === "running") {
    return Response.json({
      ok: true,
      status: "running",
      progress: job.progress,
    });
  }
  const snapshot = job.snapshot;
  if (
    snapshot.clientAccountId !== auth.clientAccountId ||
    snapshot.policyVersion !== PORTAL_BUYER_AVAILABILITY_POLICY ||
    snapshot.nicheKey !== parsed.value.nicheKey ||
    !sameCanonicalStateSet(snapshot.states) ||
    !sameCanonicalStateSet(snapshot.eligibleByState.map((row) => row.state))
  ) {
    return Response.json({
      ok: true,
      status: "complete",
      availability: portalBuyerMapUnavailable({
        nicheKey: parsed.value.nicheKey,
        requestedAgeBucket: parsed.value.requestedAgeBucket,
        requestedQuantity: parsed.value.requestedQuantity,
        lookupStatus: "unavailable",
      }),
    });
  }
  storePortalMapSnapshot(snapshot);
  return Response.json({
    ok: true,
    status: "complete",
    availability: projectPortalBuyerMapAvailability({
      snapshot,
      requestedQuantity: parsed.value.requestedQuantity,
    }),
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizedAccount();
  if (!auth.ok) return auth.response;
  const { jobId } = await context.params;
  await cancelPortalBuyerAvailabilityJob({
    clientAccountId: auth.clientAccountId,
    jobId,
  });
  return Response.json({ ok: true, status: "cancelled" });
}
