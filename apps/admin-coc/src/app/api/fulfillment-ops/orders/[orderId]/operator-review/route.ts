import { NextResponse } from "next/server";

import { adminFetchJson, adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { orderId } = await context.params;
  const result = await adminFetchJson<{ ok: boolean; items: unknown[] }>(
    `/admin/v1/fulfillment-ops/orders/${encodeURIComponent(orderId)}/operator-review`
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "operator_review_list_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { orderId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await adminRequestJson<Record<string, unknown>>(
    "POST",
    `/admin/v1/fulfillment-ops/orders/${encodeURIComponent(orderId)}/operator-review`,
    body
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "operator_review_open_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
