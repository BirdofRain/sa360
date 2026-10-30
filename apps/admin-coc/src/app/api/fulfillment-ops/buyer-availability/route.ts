import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { adminRequestJson } from "@/lib/admin-api/server";

export async function POST(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const result = await adminRequestJson<Record<string, unknown>>(
    "POST",
    "/admin/v1/fulfillment-ops/buyer-availability",
    body,
    { signal: request.signal }
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "buyer_availability_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
