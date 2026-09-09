import { NextResponse } from "next/server";

import { fetchFulfillmentOpsPplPricingCatalog } from "@/lib/fulfillment-ops/fulfillment-ops-api";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET() {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const result = await fetchFulfillmentOpsPplPricingCatalog();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details },
      { status: result.error.includes("not configured") ? 502 : 502 }
    );
  }
  return NextResponse.json({ ok: true, catalog: result.data });
}
