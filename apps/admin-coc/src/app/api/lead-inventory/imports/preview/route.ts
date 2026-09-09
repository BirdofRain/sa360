import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const body = await request.json();
  const result = await adminRequestJson("POST", "/admin/v1/lead-inventory/imports/preview", body);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.body || "admin_api_error" },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json(result.data, { status: 200 });
}
