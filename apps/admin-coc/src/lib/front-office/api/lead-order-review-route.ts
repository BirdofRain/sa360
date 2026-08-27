import { NextResponse } from "next/server";

import { requireFrontOfficeSession } from "./session";
import type { LeadOrderReviewActionResult } from "./lead-order-review-actions";

export async function handleLeadOrderReviewMutation(
  id: string,
  run: (confirmedBy: string | null) => Promise<LeadOrderReviewActionResult>
): Promise<NextResponse> {
  const session = await requireFrontOfficeSession(null);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin only" }, { status: 403 });
  }

  const result = await run(session.displayName ?? "front-office-operator");
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        code: result.code,
        reasons: result.reasons,
        order: result.order,
      },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json({ ok: true, order: result.order });
}
