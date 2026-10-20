import { NextResponse } from "next/server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { catalogViewFromAdminResult } from "@/lib/fulfillment-ops/historical-ownership-preview";

const PATH = "/admin/v1/fulfillment-ops/historical-campaign-catalog";

export async function POST(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ state: "invalid", code: "historical_campaign_catalog_invalid" }, { status: 400 });
  }
  const result = await adminRequestJson<unknown>("POST", PATH, body);
  const view = catalogViewFromAdminResult(result);
  return NextResponse.json(view.body, { status: view.status });
}
