import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { LeadFulfillmentDataBanners } from "./lead-fulfillment-data-banners.tsx";
import { LeadFulfillmentOverviewContent } from "./lead-fulfillment-overview-content.tsx";
import {
  adaptLeadFulfillmentOverviewApiResponse,
  type LeadFulfillmentOverviewApiResponse,
} from "@/lib/lead-fulfillment/lead-fulfillment-adapters";
import { getLeadFulfillmentOverviewData } from "@/lib/lead-fulfillment/mock-overview-data";

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

test("LeadFulfillmentDataBanners shows live and limited LF1 banners", () => {
  render(
    <LeadFulfillmentDataBanners
      dataSource="live"
      data={adaptLeadFulfillmentOverviewApiResponse(liveApiPayload)}
      loadError={null}
      dataLimitations={liveApiPayload.dataLimitations}
    />
  );
  assert.ok(screen.getByText("Live proof vault data"));
  assert.ok(screen.getByText("Limited LF1 data"));
  cleanup();
});

test("LeadFulfillmentDataBanners shows demo fallback banner on mock data", () => {
  render(
    <LeadFulfillmentDataBanners
      dataSource="mock"
      data={getLeadFulfillmentOverviewData()}
      loadError="Admin API error (503): unavailable"
      dataLimitations={[]}
    />
  );
  assert.ok(screen.getByText("Demo data fallback"));
  assert.ok(screen.getByText(/Admin API error \(503\)/));
  cleanup();
});

test("LeadFulfillmentOverviewContent renders live API-shaped intake row", () => {
  render(
    <LeadFulfillmentOverviewContent
      data={adaptLeadFulfillmentOverviewApiResponse(liveApiPayload)}
      dataSource="live"
      loadError={null}
      dataLimitations={liveApiPayload.dataLimitations}
      kpiIcons={{}}
    />
  );
  assert.ok(screen.getAllByText("LF-LIVE-001").length >= 1);
  assert.ok(screen.getByText("Live proof vault data"));
  cleanup();
});
