import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { itemId } = await context.params;
  const result = await adminRequestJson(
    "GET",
    `/admin/v1/lead-inventory/review/items/${encodeURIComponent(itemId)}`
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.body || "admin_api_error" },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json(result.data, { status: 200 });
}
