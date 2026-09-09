import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const path = `/admin/v1/lead-inventory/review/items${qs ? `?${qs}` : ""}`;
  const result = await adminRequestJson("GET", path);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.body || "admin_api_error" },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json(result.data, { status: 200 });
}
