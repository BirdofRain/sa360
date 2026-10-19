import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { loadHistoricalOrderDrilldown } from "@/lib/fulfillment-ops/historical-campaign-census-api";

const INCOMPLETE = {
  readOnlySnapshot: "incomplete",
  databaseIdentity: null,
  operatorVerifiedProduction: false,
  environmentLabelTrusted: false,
} as const;

export async function GET(request: Request, context: { params: Promise<{ orderNumber: string }> }) {
  const denied = await unauthorizedAdminCocBffResponse(request);
  if (denied) return denied;
  const { orderNumber } = await context.params;
  const model = await loadHistoricalOrderDrilldown(orderNumber);
  if (model.state === "disabled") {
    return NextResponse.json({ ok: false, code: "historical_campaign_census_disabled" }, { status: 404 });
  }
  if (model.state === "invalid") {
    return NextResponse.json({ ok: false, code: "historical_order_number_invalid" }, { status: 400 });
  }
  if (model.state === "not_found") {
    return NextResponse.json(
      {
        ok: false,
        complete: false,
        code: "historical_order_not_found",
        orderNumber: model.orderNumber,
      },
      { status: 404 }
    );
  }
  if (model.state !== "ready") {
    return NextResponse.json(
      {
        ok: false,
        complete: false,
        code: "historical_order_drilldown_unavailable",
        orderNumber,
        measurement: INCOMPLETE,
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, complete: true, report: model.report });
}
