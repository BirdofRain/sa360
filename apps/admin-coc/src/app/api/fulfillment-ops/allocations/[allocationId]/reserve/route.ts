import { NextResponse } from "next/server";

import { reserveFulfillmentOpsAllocation } from "@/lib/fulfillment-ops/fulfillment-ops-api";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(
  _request: Request,
  context: { params: Promise<{ allocationId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
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
