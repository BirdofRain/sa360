import { cookies } from "next/headers";

import {
  resolvePortalOrderCreateEligibility,
  submitPortalOrderCreate,
} from "@/lib/client-portal-api/portal-order-create";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { sanitizeIncomingPortalOrderCreateBody } from "@/lib/client-portal/portal-order-request";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = guardClientPortalBffSession(sessionCookie);
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

  const eligibility = await resolvePortalOrderCreateEligibility({
    clientAccountId: session.clientAccountId,
  });
  if (!eligibility.ok) {
    return Response.json(
      { ok: false, error: eligibility.error, code: eligibility.code },
      { status: eligibility.status }
    );
  }

  const body = sanitizeIncomingPortalOrderCreateBody(raw);
  if (!body) {
    return Response.json(
      { ok: false, error: "Check the highlighted fields and try again.", code: "VALIDATION" },
      { status: 400 }
    );
  }

  const result = await submitPortalOrderCreate({
    clientAccountId: session.clientAccountId,
    body,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status }
    );
  }

  return Response.json({ ok: true, item: result.item }, { status: 201 });
}
