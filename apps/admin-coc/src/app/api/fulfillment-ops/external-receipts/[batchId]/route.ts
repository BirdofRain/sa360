import { NextResponse } from "next/server";

import { adminFetchJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { batchId } = await context.params;
  const url = new URL(request.url);
  const offset = url.searchParams.get("offset") ?? "0";
  const limit = url.searchParams.get("limit") ?? "100";
  const result = await adminFetchJson<Record<string, unknown>>(
    `/admin/v1/fulfillment-ops/external-receipts/${encodeURIComponent(batchId)}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "external_receipt_batch_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
