import { NextResponse } from "next/server";

import { getDemandQueueForClient } from "@/lib/front-office/api/get-demand-queue";
import { requireFrontOfficeSession } from "@/lib/front-office/api/session";

/**
 * Client-scoped demand queue (orders + retainers).
 * Unmatched global pool is never exposed through this Front Office route.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await requireFrontOfficeSession(url.searchParams.get("role"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const clientAccountId =
    session.role === "admin"
      ? (url.searchParams.get("clientAccountId") ?? session.clientAccountId)
      : session.clientAccountId;

  if (!clientAccountId?.trim()) {
    return NextResponse.json(
      { ok: false, error: "clientAccountId required for demand queue" },
      { status: 400 }
    );
  }

  const result = await getDemandQueueForClient(clientAccountId.trim());
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "demand_queue_unavailable" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    items: result.items,
    scope: "client",
  });
}
