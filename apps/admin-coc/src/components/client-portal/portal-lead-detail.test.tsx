import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import type { PortalLeadDetailView } from "@/lib/client-portal/map-client-leads";

import { PortalLeadDetail } from "./portal-lead-detail.tsx";

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
    approvedAt: null,
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
  assert.ok(screen.getByText("Vet intake"));
  assert.ok(screen.getByText("Meta Form"));
  assert.ok(screen.getByText("Appointment set"));
  assert.ok(screen.getByText("Your account"));
  assert.ok(screen.getByText("Contact details stay masked."));
  assert.equal(screen.queryByText("meta · form"), null);
  assert.equal(screen.queryByText("appointment_set"), null);
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

test("omits empty optional rows instead of showing placeholders", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        emailMasked: null,
        funnelName: null,
        adName: null,
        soldStatus: null,
        lifecycleStage: null,
        workflowStarted: null,
        warnings: [],
        errorSummary: null,
        timeline: [],
        campaign: "—",
        sourceLabel: "—",
      })}
    />
  );
  assert.equal(screen.queryByText("Email"), null);
  assert.equal(screen.queryByText("Funnel"), null);
  assert.equal(screen.queryByText("Ad"), null);
  assert.equal(screen.queryByText("Outcome"), null);
  assert.equal(screen.queryByText("Follow-up started"), null);
  assert.ok(screen.getByText("Source details are not available yet."));
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
  cleanup();
});

test("shows customer-safe warnings when the API returns them", () => {
  render(
    <PortalLeadDetail
      lead={detail({
        warnings: ["Destination still syncing"],
        errorSummary: null,
      })}
    />
  );
  assert.ok(screen.getByText("Destination still syncing"));
  cleanup();
});
