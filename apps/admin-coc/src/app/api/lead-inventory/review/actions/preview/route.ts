import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";

export async function POST(request: Request) {
  const body = await request.json();
  const result = await adminRequestJson(
    "POST",
    "/admin/v1/lead-inventory/review/actions/preview",
    body
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.body || "admin_api_error" },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json(result.data, { status: 200 });
}
