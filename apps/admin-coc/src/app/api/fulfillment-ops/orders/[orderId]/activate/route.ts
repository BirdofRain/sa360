import { NextResponse } from "next/server";

import { activateFulfillmentOpsOrder } from "@/lib/fulfillment-ops/fulfillment-ops-api";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { orderId } = await context.params;
  const result = await activateFulfillmentOpsOrder(orderId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, order: result.data });
}
