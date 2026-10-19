import { cookies } from "next/headers";

import { fetchPortalBuyerAvailability } from "@/lib/client-portal-api/portal-buyer-availability";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { isPortalLiveInventoryEnabled } from "@/lib/client-portal/portal-live-inventory";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

function suppliedClientAccountId(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, "clientAccountId")
  );
}

export async function POST(req: Request) {
  if (!isPortalLiveInventoryEnabled()) {
    return Response.json({ ok: false, error: "portal_live_inventory_disabled" }, { status: 404 });
  }

  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = await guardClientPortalBffSession(sessionCookie);
  if (denied) return denied;

  const session = getPortalSession(sessionCookie);
  if (!session?.clientAccountId) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (suppliedClientAccountId(raw)) {
    return Response.json(
      { ok: false, error: "clientAccountId cannot be supplied" },
      { status: 400 }
    );
  }
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const nicheKey = typeof body?.nicheKey === "string" ? body.nicheKey : "";
  const states = Array.isArray(body?.states) ? body.states.filter((state) => typeof state === "string") : [];
  const commerceAgeBucketKeys = Array.isArray(body?.commerceAgeBucketKeys)
    ? body.commerceAgeBucketKeys.filter((key) => typeof key === "string")
    : [];
  const productType = typeof body?.productType === "string" ? body.productType : null;
  if (!nicheKey || states.length === 0 || commerceAgeBucketKeys.length === 0) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const result = await fetchPortalBuyerAvailability({
    session,
    nicheKey,
    states,
    commerceAgeBucketKeys,
    productType,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: "Buyer-eligible availability is unavailable." },
      { status: result.status || 503 }
    );
  }
  return Response.json(result.body);
}
