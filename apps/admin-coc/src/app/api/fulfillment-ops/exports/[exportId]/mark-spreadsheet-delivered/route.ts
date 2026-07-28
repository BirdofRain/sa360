import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ exportId: string }> }
) {
  const { exportId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await adminRequestJson<Record<string, unknown>>(
    "POST",
    `/admin/v1/fulfillment-ops/exports/${encodeURIComponent(exportId)}/mark-spreadsheet-delivered`,
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
      { ok: false, error: "mark_spreadsheet_delivered_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
