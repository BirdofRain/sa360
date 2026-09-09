import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const result = await adminRequestJson<Record<string, unknown>>(
    "POST",
    "/admin/v1/fulfillment-ops/replacements",
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
      { ok: false, error: "replacement_request_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
