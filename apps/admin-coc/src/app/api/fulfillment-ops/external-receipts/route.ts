import { NextResponse } from "next/server";

import { adminFetchJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const url = new URL(request.url);
  const clientAccountId = url.searchParams.get("clientAccountId") ?? "";
  const result = await adminFetchJson<{ ok: boolean; items: unknown[] }>(
    `/admin/v1/fulfillment-ops/external-receipts?clientAccountId=${encodeURIComponent(clientAccountId)}`
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "external_receipt_list_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
