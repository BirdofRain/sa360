import { NextResponse } from "next/server";

import { fetchFulfillmentOpsOrderLatestEvidence } from "@/lib/fulfillment-ops/fulfillment-ops-api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await context.params;
  const result = await fetchFulfillmentOpsOrderLatestEvidence(orderId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, evidence: result.data });
}
