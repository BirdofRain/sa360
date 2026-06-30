import test from "node:test";
import assert from "node:assert/strict";

import {
  getLeadFulfillmentOverviewData,
  LEAD_FULFILLMENT_MOCK_OVERVIEW,
} from "./mock-overview-data.ts";

test("mock overview includes all KPI keys", () => {
  const keys = LEAD_FULFILLMENT_MOCK_OVERVIEW.kpis.map((k) => k.key);
  assert.deepEqual(keys, [
    "leadsReceived",
    "proofAttached",
    "needsReview",
    "availableInventory",
    "activeOrders",
    "deliveredLeads",
    "deliveryFailures",
  ]);
});

test("mock overview proof summary covers required buckets", () => {
  const keys = LEAD_FULFILLMENT_MOCK_OVERVIEW.proofSummary.map((item) => item.key);
  assert.deepEqual(keys, [
    "proofAttached",
    "proofMissing",
    "needsReview",
    "rejected",
    "verificationUnchecked",
    "passed",
    "failed",
  ]);
});

test("mock overview activity uses supported fulfillment event kinds", () => {
  const kinds = new Set(LEAD_FULFILLMENT_MOCK_OVERVIEW.activity.map((event) => event.kind));
  assert.ok(kinds.has("lead_received"));
  assert.ok(kinds.has("proof_packet_created"));
  assert.ok(kinds.has("lead_verified"));
  assert.ok(kinds.has("lead_reserved"));
  assert.ok(kinds.has("lead_delivered"));
  assert.ok(kinds.has("delivery_failed"));
});

test("getLeadFulfillmentOverviewData returns mock payload", () => {
  const data = getLeadFulfillmentOverviewData();
  assert.equal(data.recentIntake.length, LEAD_FULFILLMENT_MOCK_OVERVIEW.recentIntake.length);
});
