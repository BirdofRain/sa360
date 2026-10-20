import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { previewViewFromAdminResult } from "@/lib/fulfillment-ops/historical-ownership-preview";

const PATH = "/admin/v1/historical-campaign-associations/ownership-previews";

export async function POST(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ state: "invalid", code: "historical_ownership_preview_invalid" }, { status: 400 });
  }
  const result = await adminRequestJson<unknown>("POST", PATH, body);
  const view = previewViewFromAdminResult(result);
  return NextResponse.json(view.body, { status: view.status });
}
