import { NextResponse } from "next/server";

import { simulateFulfillmentOpsInstruction } from "@/lib/fulfillment-ops/fulfillment-ops-api";

export async function POST(
  _request: Request,
  context: { params: Promise<{ instructionId: string }> }
) {
  const { instructionId } = await context.params;
  const result = await simulateFulfillmentOpsInstruction(instructionId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 409 }
    );
  }
  return NextResponse.json(result.data);
}
