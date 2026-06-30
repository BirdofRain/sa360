import assert from "node:assert/strict";
import test from "node:test";

import { getLeadFulfillmentOverviewData } from "./mock-overview-data.ts";
import {
  adaptLeadFulfillmentOverviewApiResponse,
  hasLimitedLf1ModuleKpis,
  type LeadFulfillmentOverviewApiResponse,
} from "./lead-fulfillment-adapters.ts";

test("adaptLeadFulfillmentOverviewApiResponse preserves KPI count and proof summary keys", () => {
  const mock = getLeadFulfillmentOverviewData();
  const payload: LeadFulfillmentOverviewApiResponse = {
    dataSource: "lead_proof_vault",
    dataLimitations: [],
    ...mock,
    kpis: mock.kpis.map((kpi) => ({ ...kpi })),
    proofSummary: mock.proofSummary.map((item) => ({ ...item })),
    recentIntake: mock.recentIntake.map((row) => ({
      ...row,
      proofStatus: row.proofStatus,
      verificationStatus: row.verificationStatus,
      inventoryStatus: row.inventoryStatus,
    })),
    activity: mock.activity.map((event) => ({ ...event })),
  };

  const adapted = adaptLeadFulfillmentOverviewApiResponse(payload);
  assert.equal(adapted.kpis.length, 7);
  assert.equal(adapted.proofSummary.length, 7);
  assert.equal(adapted.recentIntake.length, mock.recentIntake.length);
});

test("hasLimitedLf1ModuleKpis is false for mock overview demo KPIs", () => {
  assert.equal(hasLimitedLf1ModuleKpis(getLeadFulfillmentOverviewData()), false);
});
