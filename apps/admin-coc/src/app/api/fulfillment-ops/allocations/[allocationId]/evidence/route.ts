import { NextResponse } from "next/server";

import { fetchFulfillmentOpsEvidence } from "@/lib/fulfillment-ops/fulfillment-ops-api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ allocationId: string }> }
) {
  const { allocationId } = await context.params;
  const result = await fetchFulfillmentOpsEvidence(allocationId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, evidence: result.data });
}
