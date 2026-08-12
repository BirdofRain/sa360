import { NextResponse } from "next/server";

import {
  createFulfillmentOpsClientLeadOrder,
  fetchFulfillmentOpsOrders,
} from "@/lib/fulfillment-ops/fulfillment-ops-api";

export async function GET() {
  const result = await fetchFulfillmentOpsOrders();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, items: result.data });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Accept either requestedQuantity (preferred) or legacy leadVolume from demo callers.
  const requestedQuantity =
    typeof body.requestedQuantity === "number"
      ? body.requestedQuantity
      : typeof body.leadVolume === "number"
        ? body.leadVolume
        : Number(body.requestedQuantity ?? body.leadVolume);

  const result = await createFulfillmentOpsClientLeadOrder({
    ...body,
    requestedQuantity,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, item: result.data }, { status: 201 });
}
