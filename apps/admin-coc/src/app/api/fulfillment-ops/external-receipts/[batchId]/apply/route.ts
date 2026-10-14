import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { batchId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await adminRequestJson<Record<string, unknown>>(
    "POST",
    `/admin/v1/fulfillment-ops/external-receipts/${encodeURIComponent(batchId)}/apply`,
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
      { ok: false, error: "external_receipt_apply_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
