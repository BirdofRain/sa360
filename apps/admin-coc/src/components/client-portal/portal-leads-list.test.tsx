import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalLeadsList } from "./portal-leads-list.tsx";

test("shows an empty state when there are no leads", () => {
  render(<PortalLeadsList leads={[]} />);
  assert.ok(screen.getByText("No leads yet"));
  assert.ok(screen.getByText("Leads"));
  assert.equal(screen.queryByText("Delivered leads"), null);
  assert.equal(screen.queryByText("No delivered leads yet"), null);
  assert.equal(screen.queryByText("No delivered leads match this filter."), null);
  cleanup();
});

test("shows a filtered empty state for the delivered status filter", () => {
  render(<PortalLeadsList leads={[]} statusFilter="delivered" />);
  assert.ok(screen.getByText("No delivered leads match this filter."));
  assert.ok(screen.getByText("Delivered leads"));
  assert.equal(screen.queryByText("No leads yet"), null);
  assert.equal(screen.queryByText("No delivered leads yet"), null);
  cleanup();
});

test("renders a mapped delivered lead", () => {
  render(
    <PortalLeadsList
      leads={[
        {
          id: "lead_1",
          leadName: "Alex P.",
          phoneMasked: "(•••) •••-1212",
          campaign: "Vet Q2",
          sourceLabel: "meta · form",
          receivedAt: new Date().toISOString(),
          deliveryStatus: "delivered",
          deliveryLabel: "Delivered",
          lastEvent: "lead_delivered",
          appointmentStatus: "set",
        },
      ]}
    />
  );
  assert.ok(screen.getAllByText("Alex P.").length >= 1);
  assert.ok(screen.getAllByText("Vet Q2").length >= 1);
  assert.ok(screen.getAllByText("Delivered").length >= 1);
  assert.ok(screen.getAllByText("Meta Form").length >= 1);
  assert.ok(screen.getAllByText("Set").length >= 1);
  assert.equal(screen.queryByText("meta · form"), null);
  assert.ok(screen.getByText("Leads"));
  assert.equal(screen.queryByText("Delivered leads"), null);
  const viewLinks = screen.getAllByRole("link", { name: "View lead" });
  assert.ok(viewLinks.length >= 1);
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/leads/lead_1");
  cleanup();
});

test("View lead stays available from a delivered-filtered list", () => {
  render(
    <PortalLeadsList
      statusFilter="delivered"
      leads={[
        {
          id: "lead_2",
          leadName: "Jordan K.",
          phoneMasked: null,
          campaign: "Home Q3",
          sourceLabel: "web · form",
          receivedAt: new Date().toISOString(),
          deliveryStatus: "delivered",
          deliveryLabel: "Delivered",
          lastEvent: null,
          appointmentStatus: null,
        },
      ]}
    />
  );
  const viewLinks = screen.getAllByRole("link", { name: "View lead" });
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/leads/lead_2?status=delivered");
  assert.ok(screen.getByText("Delivered leads"));
  cleanup();
});

test("hides LeadCapture Webhook and other ingestion plumbing", () => {
  render(
    <PortalLeadsList
      leads={[
        {
          id: "lead_lc",
          leadName: "Sam R.",
          phoneMasked: null,
          campaign: "Vet FEX - LeadCapture NextGen",
          sourceLabel: "leadcapture_io · webhook",
          receivedAt: new Date().toISOString(),
          deliveryStatus: "delivered",
          deliveryLabel: "Delivered",
          lastEvent: "lead_routed",
          appointmentStatus: null,
        },
      ]}
    />
  );
  assert.ok(screen.getAllByText("Sam R.").length >= 1);
  assert.equal(screen.queryByText("LeadCapture Webhook"), null);
  assert.equal(screen.queryByText(/LeadCapture/i), null);
  assert.equal(screen.queryByText(/webhook/i), null);
  assert.equal(screen.queryByText("Vet FEX - LeadCapture NextGen"), null);
  assert.equal(screen.queryByText("Routed"), null);
  cleanup();
});

test("All list navigation omits the status query on View lead", () => {
  render(
    <PortalLeadsList
      statusFilter="all"
      leads={[
        {
          id: "lead_3",
          leadName: "Casey M.",
          phoneMasked: null,
          campaign: "Vet Q2",
          sourceLabel: "web · form",
          receivedAt: new Date().toISOString(),
          deliveryStatus: "delivered",
          deliveryLabel: "Delivered",
          lastEvent: null,
          appointmentStatus: null,
        },
      ]}
    />
  );
  const viewLinks = screen.getAllByRole("link", { name: "View lead" });
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/leads/lead_3");
  assert.ok(screen.getAllByText("Web Form").length >= 1);
  cleanup();
});
