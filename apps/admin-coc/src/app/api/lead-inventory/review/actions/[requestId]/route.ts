import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { requestId } = await context.params;
  const result = await adminRequestJson(
    "GET",
    `/admin/v1/lead-inventory/review/actions/${encodeURIComponent(requestId)}`
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.body || "admin_api_error" },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json(result.data, { status: 200 });
}
