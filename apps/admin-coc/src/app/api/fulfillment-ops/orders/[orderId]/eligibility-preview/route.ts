import { NextResponse } from "next/server";

import { fetchEligibilityPreview } from "@/lib/fulfillment-ops/fulfillment-ops-api";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { orderId } = await context.params;
  const result = await fetchEligibilityPreview(orderId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, preview: result.data });
}
