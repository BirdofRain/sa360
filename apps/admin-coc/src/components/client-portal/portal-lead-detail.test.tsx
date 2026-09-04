import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import type { PortalLeadDetailView } from "@/lib/client-portal/map-client-leads";

import { PortalLeadDetail } from "./portal-lead-detail.tsx";

test.afterEach(() => {
  cleanup();
});

function detail(overrides: Partial<PortalLeadDetailView> = {}): PortalLeadDetailView {
  return {
    id: "lead_1",
    leadName: "Alex P.",
    phoneMasked: "(•••) •••-1212",
    campaign: "Vet Q2",
    sourceLabel: "meta · form",
    receivedAt: "2026-08-20T10:00:00.000Z",
    deliveryStatus: "delivered",
    deliveryLabel: "Delivered",
    lastEvent: "lead_delivered",
    appointmentStatus: "set",
    emailMasked: "a***@example.com",
    lastEventAt: "2026-08-20T11:00:00.000Z",
    soldStatus: null,
    routingStatus: "matched",
    routingLabel: "Matched",
    matchedClient: "Your account",
    workflowStarted: true,
    lifecycleStage: "appointment_set",
    funnelName: "Vet intake",
    adName: "Spring offer",
    deliveredAt: "2026-08-20T11:00:00.000Z",
    approvedAt: "2026-08-20T10:30:00.000Z",
    warnings: [],
    errorSummary: null,
    timeline: [
      {
        milestone: "lead_delivered",
        milestoneLabel: "Delivered",
        at: "2026-08-20T11:00:00.000Z",
        status: "complete",
        detail: null,
      },
    ],
    state: "TX",
    age: "42",
    leadType: "vet",
    ...overrides,
  };
}

test("renders customer-safe detail and back navigation", () => {
  render(<PortalLeadDetail lead={detail()} />);
  assert.ok(screen.getByRole("heading", { name: "Alex P." }));
  assert.ok(screen.getByRole("link", { name: "Back to Leads" }));
  assert.equal(screen.getByRole("link", { name: "Back to Leads" }).getAttribute("href"), "/portal/leads");
  assert.ok(screen.getAllByText("Delivered").length >= 1);
  assert.ok(screen.getByText("(•••) •••-1212"));
  assert.ok(screen.getByText("a***@example.com"));
  assert.ok(screen.getByText("Vet Q2"));
  assert.ok(screen.getByText("Meta Form"));
  assert.ok(screen.getByText("TX"));
  assert.ok(screen.getByText("42"));
  assert.ok(screen.getByText("Veteran"));
  assert.ok(screen.getByText("Set"));
  assert.ok(screen.getByText("Contact details stay masked."));
  assert.equal(screen.queryByText("meta · form"), null);
  assert.equal(screen.queryByText("appointment_set"), null);
  cleanup();
});

test("hides InboundContactIndex warnings and operator sections", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        sourceLabel: "leadcapture_io · webhook",
        funnelName: "Vet intake",
        adName: "Spring offer",
        routingLabel: "Matched",
        lifecycleStage: "appointment_set",
        workflowStarted: true,
        matchedClient: "Your account",
        warnings: ["No InboundContactIndex snapshot found for this lead scope."],
        errorSummary: "LeadCapture webhook debug status: queued",
        timeline: [
          {
            milestone: "lead_routed",
            milestoneLabel: "Routed",
            at: "2026-08-20T10:02:00.000Z",
            status: "complete",
            detail: null,
          },
          {
            milestone: "client_workflow_started",
            milestoneLabel: "Follow-up started",
            at: "2026-08-20T11:05:00.000Z",
            status: "complete",
            detail: "GHL workflow started",
          },
          {
            milestone: "lead_delivered",
            milestoneLabel: "Delivered",
            at: "2026-08-20T11:00:00.000Z",
            status: "complete",
            detail: null,
          },
        ],
      })}
    />
  );
  assert.equal(screen.queryByText("No InboundContactIndex snapshot found for this lead scope."), null);
  assert.equal(screen.queryByText(/InboundContactIndex/), null);
  assert.equal(screen.queryByText("LeadCapture Webhook"), null);
  assert.equal(screen.queryByText("LeadCapture webhook debug status: queued"), null);
  assert.equal(screen.queryByText("Funnel"), null);
  assert.equal(screen.queryByText("Vet intake"), null);
  assert.equal(screen.queryByText("Ad"), null);
  assert.equal(screen.queryByText("Spring offer"), null);
  assert.equal(screen.queryByText("Routing"), null);
  assert.equal(screen.queryByText("Matched"), null);
  assert.equal(screen.queryByText("Follow-up started"), null);
  assert.equal(screen.queryByText("Lifecycle"), null);
  assert.equal(screen.queryByText("Your account"), null);
  assert.equal(screen.queryByText("Routed"), null);
  assert.ok(screen.getAllByText("Alex P.").length >= 1);
  assert.ok(screen.getByText("Vet Q2"));
  cleanup();
});

test("Delivered filter navigation is preserved on Back to Leads", () => {
  render(<PortalLeadDetail lead={detail()} listStatus="delivered" />);
  assert.equal(
    screen.getByRole("link", { name: "Back to Leads" }).getAttribute("href"),
    "/portal/leads?status=delivered"
  );
  cleanup();
});

test("invalid list filter falls back to All on Back to Leads", () => {
  render(<PortalLeadDetail lead={detail()} listStatus={"bogus" as "all"} />);
  assert.equal(screen.getByRole("link", { name: "Back to Leads" }).getAttribute("href"), "/portal/leads");
  cleanup();
});

test("status pill stays compact on the lead detail header", () => {
  const { container } = render(<PortalLeadDetail lead={detail()} />);
  const pill = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === "Delivered");
  assert.ok(pill);
  assert.match(pill.className, /w-fit/);
  assert.match(pill.className, /self-start/);
  cleanup();
});

test("does not invent order linkage or unmasked contact fields", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        phoneMasked: "(•••) •••-1212",
        emailMasked: "a***@example.com",
      })}
    />
  );
  assert.equal(screen.queryByText("Order"), null);
  assert.equal(screen.queryByText("+1555121212"), null);
  assert.equal(screen.queryByText("alex@example.com"), null);
  assert.equal(screen.queryByText("adminDetail"), null);
  cleanup();
});

test("omits empty optional rows instead of showing internal placeholders", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        emailMasked: null,
        funnelName: "Hidden funnel",
        adName: "Hidden ad",
        soldStatus: null,
        lifecycleStage: null,
        workflowStarted: null,
        warnings: ["No InboundContactIndex snapshot found for this lead scope."],
        errorSummary: null,
        timeline: [],
        campaign: "—",
        sourceLabel: "leadcapture_io · webhook",
        state: null,
        age: null,
        leadType: null,
      })}
    />
  );
  assert.equal(screen.queryByText("Email"), null);
  assert.equal(screen.queryByText("Funnel"), null);
  assert.equal(screen.queryByText("Ad"), null);
  assert.equal(screen.queryByText("Outcome"), null);
  assert.equal(screen.queryByText("Follow-up started"), null);
  assert.equal(screen.queryByText("State"), null);
  assert.equal(screen.queryByText("Age"), null);
  assert.equal(screen.queryByText("Lead type"), null);
  assert.equal(screen.queryByText("Source details are not available yet."), null);
  assert.equal(screen.queryByText("LeadCapture Webhook"), null);
  assert.equal(screen.queryByText("Activity"), null);
  assert.equal(screen.queryByText("undefined"), null);
  assert.equal(screen.queryByText("null"), null);
  cleanup();
});

test("partial payloads omit missing date rows instead of showing broken dates", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        receivedAt: "",
        deliveredAt: null,
        approvedAt: "not-a-date",
        lastEventAt: null,
        timeline: [],
      })}
    />
  );
  assert.equal(screen.queryByText("Dates"), null);
  assert.equal(screen.queryByText("Approved"), null);
  cleanup();
});

test("shows customer-safe notes and hides internal error copy", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        warnings: ["Destination still syncing", "No InboundContactIndex snapshot found for this lead scope."],
        errorSummary: "GHL automation warning: workflow missing",
      })}
    />
  );
  assert.ok(screen.getByText("Destination still syncing"));
  assert.equal(screen.queryByText("No InboundContactIndex snapshot found for this lead scope."), null);
  assert.equal(screen.queryByText(/GHL automation/), null);
  cleanup();
});
