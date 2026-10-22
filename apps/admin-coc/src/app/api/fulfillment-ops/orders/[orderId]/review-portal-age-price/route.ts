import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { recordPortalAgePriceReview } from "@/lib/fulfillment-ops/fulfillment-ops-api";

export async function POST(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { orderId } = await context.params;
  const result = await recordPortalAgePriceReview(orderId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, item: result.data });
}
