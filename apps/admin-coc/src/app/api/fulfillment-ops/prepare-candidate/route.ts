import { NextResponse } from "next/server";

import { prepareFulfillmentOpsCandidate } from "@/lib/fulfillment-ops/fulfillment-ops-api";

export async function POST(request: Request) {
  let body: { leadOrderId?: string; inventoryItemId?: string };
  try {
    body = (await request.json()) as { leadOrderId?: string; inventoryItemId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body.leadOrderId?.trim() || !body.inventoryItemId?.trim()) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const result = await prepareFulfillmentOpsCandidate({
    leadOrderId: body.leadOrderId,
    inventoryItemId: body.inventoryItemId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 409 }
    );
  }
  return NextResponse.json(result.data);
}
