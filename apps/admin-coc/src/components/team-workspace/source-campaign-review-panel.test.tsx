import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { SourceCampaignReviewPanel } from "./source-campaign-review-panel.tsx";
import type { SourceCampaignReviewView } from "@/lib/team-workspace/source-campaign-review";

function view(overrides: Partial<SourceCampaignReviewView> = {}): SourceCampaignReviewView {
  return {
    availability: "ready",
    disposition: "saved_request",
    revision: 4,
    requested: { trafficSourceName: "NextGen page", providerFunnelId: "funnel-1", providerCampaignId: "campaign-1" },
    sourceStatus: "confirmed_for_client",
    campaignStatus: "live_routing_rule",
    sourceAssociated: true,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: true,
    campaignOwnership: "this_client",
    attention: ["This client has a live routing rule, and delivery is not enabled on it.", "Delivery confirmed: no. This check does not read a GoHighLevel or Company Sheets receipt."],
    ...overrides,
  };
}

test.afterEach(() => {
  cleanup();
});

test("the panel shows the saved request and does not offer an operational action", () => {
  render(<SourceCampaignReviewPanel clientAccountId="alex_gross" review={view()} draftFunnelId="funnel-1" draftCampaignId="campaign-1" />);
  assert.equal(screen.getByText("Confirmed for this client.").textContent, "Confirmed for this client.");
  assert.match(screen.getAllByText(/does not have delivery enabled/)[0]?.textContent ?? "", /delivery enabled/);
  assert.match(screen.getAllByText(/does not read a GoHighLevel/)[0]?.textContent ?? "", /No/);
  const link = screen.getByRole("link", { name: "Open the client screen to review sources and campaign rules" });
  assert.equal(link.getAttribute("href"), "/clients/alex_gross");
  for (const name of ["Apply", "Confirm", "Reassign", "Create Rule", "Activate"]) {
    assert.equal(screen.queryByRole("button", { name }), null);
  }
  assert.equal(screen.queryByRole("button"), null);
});

test("a missing review is shown as not verified", () => {
  render(<SourceCampaignReviewPanel clientAccountId="alex_gross" review={null} draftFunnelId="" draftCampaignId="" />);
  assert.match(screen.getByText("Not confirmed. This is not a verification.").textContent ?? "", /not a verification/i);
  assert.match(screen.getByText(/Nothing was verified/).textContent ?? "", /Nothing was verified/);
  assert.equal(screen.queryByRole("button", { name: /confirm|apply|activate|reassign/i }), null);
});
