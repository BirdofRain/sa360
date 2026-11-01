import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { adminRequestJson } from "@/lib/admin-api/server";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { jobId } = await context.params;
  const result = await adminRequestJson<Record<string, unknown>>(
    "GET",
    `/admin/v1/fulfillment-ops/buyer-availability/jobs/${encodeURIComponent(jobId)}`
  );
  if (!result.ok) {
    let details: unknown = result.body;
    try {
      details = JSON.parse(result.body);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "buyer_availability_failed", details },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { jobId } = await context.params;
  const result = await adminRequestJson<Record<string, unknown>>(
    "DELETE",
    `/admin/v1/fulfillment-ops/buyer-availability/jobs/${encodeURIComponent(jobId)}`
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "buyer_availability_failed" },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(result.data);
}
