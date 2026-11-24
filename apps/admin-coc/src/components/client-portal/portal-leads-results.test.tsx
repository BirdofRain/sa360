import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import type { PortalLeadView } from "../../lib/client-portal/map-client-leads.ts";
import {
  PORTAL_LEAD_LIST_CONTINUE_LABEL,
  PORTAL_LEAD_LIST_NEXT_LABEL,
} from "../../lib/client-portal/portal-lead-list-status.ts";

import { PortalLeadsResults } from "./portal-leads-results.tsx";

const filters = {
  q: "Quartz",
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-11-30T23:59:59.999Z",
};

function lead(id: string): PortalLeadView {
  return {
    id,
    leadName: id,
    phoneMasked: null,
    campaign: "Quartz",
    sourceLabel: "web · form",
    receivedAt: "2026-11-20T12:00:00.000Z",
    deliveryStatus: "delivered",
    deliveryLabel: "Delivered",
    lastEvent: "lead_delivered",
    appointmentStatus: null,
  };
}

function hrefParams(name: string): URLSearchParams {
  const href = screen.getByRole("link", { name }).getAttribute("href");
  assert.ok(href);
  return new URL(href, "http://portal.local").searchParams;
}

test("fifty delivered leads offer Next, and that link is the fifty-first page", () => {
  const page = Array.from({ length: 50 }, (_, index) => lead(`lead_${index + 1}`));
  render(
    <PortalLeadsResults
      statusFilter="delivered"
      filters={filters}
      leads={page}
      nextCursor="lead_50"
    />
  );
  assert.equal(screen.queryByText("No delivered leads match this filter."), null);
  assert.equal(screen.queryByText(PORTAL_LEAD_LIST_CONTINUE_LABEL), null);
  const params = hrefParams(PORTAL_LEAD_LIST_NEXT_LABEL);
  assert.equal(params.get("status"), "delivered");
  assert.equal(params.get("q"), "Quartz");
  assert.equal(params.get("from"), filters.from);
  assert.equal(params.get("to"), filters.to);
  assert.equal(params.get("cursor"), "lead_50");
  assert.equal(params.get("clientAccountId"), null);
  cleanup();

  render(
    <PortalLeadsResults
      statusFilter="delivered"
      filters={filters}
      leads={[lead("lead_51")]}
      nextCursor={null}
    />
  );
  assert.ok(screen.getAllByText("lead_51").length >= 1);
  assert.equal(screen.queryByRole("link", { name: PORTAL_LEAD_LIST_NEXT_LABEL }), null);
  assert.equal(screen.queryByText(PORTAL_LEAD_LIST_CONTINUE_LABEL), null);
  assert.equal(screen.queryByText("No delivered leads match this filter."), null);
  cleanup();
});

test("a scan with no matches offers continuation, and the final empty state waits for no cursor", () => {
  render(
    <PortalLeadsResults statusFilter="delivered" filters={filters} leads={[]} nextCursor="row_200" />
  );
  assert.equal(screen.queryByText("No delivered leads match this filter."), null);
  const params = hrefParams(PORTAL_LEAD_LIST_CONTINUE_LABEL);
  assert.equal(params.get("cursor"), "row_200");
  assert.equal(params.get("status"), "delivered");
  assert.equal(params.get("q"), "Quartz");
  assert.equal(params.get("from"), filters.from);
  assert.equal(params.get("to"), filters.to);
  cleanup();

  render(
    <PortalLeadsResults statusFilter="delivered" filters={filters} leads={[]} nextCursor={null} />
  );
  assert.ok(screen.getByText("No delivered leads match this filter."));
  assert.equal(screen.queryByText(PORTAL_LEAD_LIST_CONTINUE_LABEL), null);
  assert.equal(screen.queryByRole("link", { name: PORTAL_LEAD_LIST_NEXT_LABEL }), null);
  cleanup();
});
