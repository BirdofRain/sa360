import { NextResponse } from "next/server";

import { adminFetchJson } from "@/lib/admin-api/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await context.params;
  const result = await adminFetchJson<{ ok: boolean; items: unknown[] }>(
    `/admin/v1/fulfillment-ops/orders/${encodeURIComponent(orderId)}/replacements`
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "replacement_list_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
