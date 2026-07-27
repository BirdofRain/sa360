import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await adminRequestJson<Record<string, unknown>>(
    "POST",
    `/admin/v1/fulfillment-ops/replacements/${encodeURIComponent(id)}/decision`,
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
      { ok: false, error: "replacement_decision_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
