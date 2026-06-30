import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptLeadFulfillmentOverviewApiResponse,
  hasLimitedLf1ModuleKpis,
  type LeadFulfillmentOverviewApiResponse,
} from "./lead-fulfillment-adapters.ts";
import { getLeadFulfillmentOverviewData } from "./mock-overview-data.ts";

const liveApiPayload: LeadFulfillmentOverviewApiResponse = {
  dataSource: "lead_proof_vault",
  dataLimitations: ["Inventory module not implemented yet."],
  kpis: [
    { key: "leadsReceived", label: "Leads received", value: 2, tone: "neutral" },
    { key: "proofAttached", label: "Proof attached", value: 1, tone: "good" },
    { key: "needsReview", label: "Needs review", value: 0, tone: "neutral" },
    {
      key: "availableInventory",
      label: "Available inventory",
      value: 0,
      hint: "Inventory module not implemented yet.",
    },
    {
      key: "activeOrders",
      label: "Active orders",
      value: 0,
      hint: "Order module not implemented yet.",
    },
    {
      key: "deliveredLeads",
      label: "Delivered leads",
      value: 0,
      hint: "Fulfillment delivery audit counts not wired yet.",
    },
    {
      key: "deliveryFailures",
      label: "Delivery failures",
      value: 0,
      hint: "Delivery failure counts not wired yet.",
    },
  ],
  proofSummary: [
    { key: "proofAttached", label: "Proof attached", count: 1, tone: "good" },
    { key: "proofMissing", label: "Proof missing", count: 1, tone: "warn" },
    { key: "needsReview", label: "Needs review", count: 0, tone: "warn" },
    { key: "rejected", label: "Rejected", count: 0, tone: "bad" },
    { key: "verificationUnchecked", label: "Verification unchecked", count: 1, tone: "neutral" },
    { key: "passed", label: "Passed", count: 1, tone: "good" },
    { key: "failed", label: "Failed", count: 0, tone: "bad" },
  ],
  recentIntake: [
    {
      leadUid: "LF-LIVE-001",
      sourceLane: "Meta Lead Ads",
      state: "TX",
      niche: "Solar",
      proofStatus: "attached",
      verificationStatus: "passed",
      inventoryStatus: "available",
      createdAt: "2026-06-30T12:00:00.000Z",
    },
  ],
  activity: [
    {
      id: "evt-live-1",
      kind: "lead_verified",
      leadUid: "LF-LIVE-001",
      summary: "Verification status passed — compliance review ready pending inventory rules.",
      at: "2026-06-30T12:05:00.000Z",
    },
  ],
};

test("adaptLeadFulfillmentOverviewApiResponse maps API payload into overview data", () => {
  const adapted = adaptLeadFulfillmentOverviewApiResponse(liveApiPayload);
  assert.equal(adapted.kpis.length, 7);
  assert.equal(adapted.recentIntake[0]?.leadUid, "LF-LIVE-001");
  assert.equal(adapted.recentIntake[0]?.proofStatus, "attached");
  assert.equal(adapted.activity[0]?.kind, "lead_verified");
});

test("hasLimitedLf1ModuleKpis detects placeholder module KPI hints", () => {
  const adapted = adaptLeadFulfillmentOverviewApiResponse(liveApiPayload);
  assert.equal(hasLimitedLf1ModuleKpis(adapted), true);
  assert.equal(hasLimitedLf1ModuleKpis(getLeadFulfillmentOverviewData()), false);
});
