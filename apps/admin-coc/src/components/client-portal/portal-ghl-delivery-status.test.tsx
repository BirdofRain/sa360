import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import {
  mapClientLeadDeliveryDetail,
  mapClientLeadDeliveryRow,
} from "@/lib/client-portal/map-client-leads";
import { portalCustomerLastEvent } from "@/lib/client-portal/portal-lead-customer";

import { PortalLeadDetail } from "./portal-lead-detail.tsx";
import { PortalLeadsList } from "./portal-leads-list.tsx";

test.afterEach(() => {
  cleanup();
});

function listLead(deliveryStatus: string, lastEventName: string | null) {
  const row = mapClientLeadDeliveryRow({
    id: "lead_alex",
    leadName: "Alex Gross",
    receivedAt: "2026-11-23T17:59:00.000Z",
    deliveryStatus,
    lastEventName,
    sourcePlatform: "leadcapture_io",
    sourceType: "webhook",
  });
  if (!row) throw new Error("list row did not map");
  return row;
}

test("before: list badge and customer subline disagree for a canonical partial success", () => {
  const lead = listLead("not_started", "lead_delivered");
  assert.equal(lead.deliveryLabel, "Not started");
  assert.equal(portalCustomerLastEvent(lead.lastEvent), "Delivered");
  render(<PortalLeadsList leads={[lead]} />);
  assert.ok(screen.getAllByText("Not started").length >= 1);
  assert.ok(screen.getAllByText("Delivered").length >= 1);
});

test("after: list badge and customer subline both say Delivered", () => {
  const lead = listLead("delivered", "lead_delivered");
  assert.equal(lead.deliveryLabel, "Delivered");
  assert.equal(portalCustomerLastEvent(lead.lastEvent), "Delivered");
  render(<PortalLeadsList leads={[lead]} />);
  assert.equal(screen.queryByText("Not started"), null);
  assert.ok(screen.getAllByText("Delivered").length >= 2);
});

test("after: detail badge and delivery line agree, and a contact-only failure does not say Delivered", () => {
  const delivered = mapClientLeadDeliveryDetail({
    id: "lead_alex",
    leadName: "Alex Gross",
    receivedAt: "2026-11-23T17:59:00.000Z",
    deliveryStatus: "delivered",
    lastEventName: "lead_delivered",
    delivery: { deliveredAt: "2026-11-23T18:05:00.000Z" },
    timeline: [],
  });
  if (!delivered) throw new Error("detail did not map");
  render(<PortalLeadDetail lead={delivered} />);
  assert.equal(delivered.deliveryLabel, "Delivered");
  assert.ok(screen.getAllByText(/Delivered/).length >= 1);
  assert.equal(screen.queryByText("Not started"), null);
  cleanup();

  const held = mapClientLeadDeliveryDetail({
    id: "lead_held",
    leadName: "Alex Gross",
    receivedAt: "2026-11-23T17:59:00.000Z",
    deliveryStatus: "not_started",
    lastEventName: "lead_routed",
    delivery: { deliveredAt: null },
    timeline: [],
  });
  if (!held) throw new Error("held detail did not map");
  assert.equal(held.deliveryLabel, "Not started");
  assert.equal(portalCustomerLastEvent(held.lastEvent), null);
  render(<PortalLeadDetail lead={held} />);
  assert.ok(screen.getAllByText("Not started").length >= 1);
  assert.equal(screen.queryByText(/^Delivered/), null);
  assert.ok(screen.getAllByText(/Generated/).length >= 1);
});
