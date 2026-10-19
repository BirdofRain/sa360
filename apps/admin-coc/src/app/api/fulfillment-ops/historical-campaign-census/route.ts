import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { loadHistoricalCampaignCensus } from "@/lib/fulfillment-ops/historical-campaign-census-api";

export async function GET(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse(request);
  if (denied) return denied;
  const model = await loadHistoricalCampaignCensus();
  if (model.state === "disabled") {
    return NextResponse.json({ ok: false, code: "historical_campaign_census_disabled" }, { status: 404 });
  }
  if (model.state !== "ready") {
    return NextResponse.json(
      {
        ok: false,
        complete: false,
        code: "historical_campaign_census_unavailable",
        measurement: {
          readOnlySnapshot: "incomplete",
          databaseIdentity: null,
          operatorVerifiedProduction: false,
          environmentLabelTrusted: false,
        },
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, complete: true, report: model.report });
}
