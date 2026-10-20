import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { loadProvenanceImpactPanel } from "@/lib/fulfillment-ops/provenance-impact-api";

export async function GET(request: Request) {
  const denied = await unauthorizedAdminCocBffResponse(request);
  if (denied) return denied;
  const model = await loadProvenanceImpactPanel();
  if (model.state === "disabled") {
    return NextResponse.json(
      { ok: false, code: "provenance_impact_audit_disabled" },
      { status: 404 }
    );
  }
  if (model.state === "unavailable") {
    return NextResponse.json(
      {
        ok: false,
        complete: false,
        code: "provenance_impact_unavailable",
        productionImpactMeasured: false,
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
  return NextResponse.json({
    ok: true,
    complete: true,
    productionImpactMeasured: false,
    report: model.report,
  });
}
