import { NextResponse } from "next/server";

import { reserveFulfillmentOpsAllocation } from "@/lib/fulfillment-ops/fulfillment-ops-api";

export async function POST(
  _request: Request,
  context: { params: Promise<{ allocationId: string }> }
) {
  const { allocationId } = await context.params;
  const result = await reserveFulfillmentOpsAllocation(allocationId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 409 }
    );
  }
  return NextResponse.json(result.data);
}
