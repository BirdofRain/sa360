import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_ORDER_FULFILLMENT_PLACEHOLDER } from "@/lib/client-portal/map-client-orders";
import type { PortalOrderDetailView } from "@/lib/client-portal/map-client-orders";

import { PortalOrderDetail } from "./portal-order-detail.tsx";

function detail(overrides: Partial<PortalOrderDetailView> = {}): PortalOrderDetailView {
  return {
    id: "ord_1",
    orderNumber: "LO-1001",
    status: "active",
    nicheLabel: "vet",
    productLabel: "exclusive",
    statesLabel: "TX",
    volume: 25,
    campaignType: "aged",
    destination: "GHL location",
    fulfillmentSummary: PORTAL_ORDER_FULFILLMENT_PLACEHOLDER,
    setupWarnings: [],
    createdAt: "2026-08-01T12:00:00.000Z",
    states: ["TX", "OK"],
    deliveryCadence: "weekly",
    crmPackage: "GHL Pro",
    aiVoiceAddon: true,
    requestedStartDate: null,
    destinationType: null,
    notes: null,
    submittedAt: "2026-08-01T13:00:00.000Z",
    approvedAt: null,
    activatedAt: "2026-08-02T09:00:00.000Z",
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    updatedAt: null,
    fulfillmentSummaryIsPlaceholder: true,
    ...overrides,
  };
}

test("renders customer-safe detail and back navigation", () => {
  render(<PortalOrderDetail order={detail()} />);
  assert.ok(screen.getByRole("heading", { name: "LO-1001" }));
  assert.ok(screen.getByRole("link", { name: "Back to Orders" }));
  assert.ok(screen.getByText("Active"));
  assert.ok(screen.getByText("25"));
  assert.ok(screen.getByText("TX"));
  assert.ok(screen.getByText("OK"));
  assert.ok(screen.getByText("Detailed fulfillment progress is not available yet."));
  assert.equal(screen.queryByText(PORTAL_ORDER_FULFILLMENT_PLACEHOLDER), null);
  assert.ok(screen.getByRole("link", { name: "View account leads" }));
  cleanup();
});

test("omits unsupported price fields and empty optional rows", () => {
  render(<PortalOrderDetail order={detail({ productLabel: null, destination: "—" })} />);
  assert.equal(screen.queryByText("Order total"), null);
  assert.equal(screen.queryByText("Price per lead"), null);
  assert.equal(screen.queryByText("undefined"), null);
  assert.equal(screen.queryByText("null"), null);
  cleanup();
});

test("shows a real fulfillment summary when it is not the backend placeholder", () => {
  render(
    <PortalOrderDetail
      order={detail({
        fulfillmentSummary: "12 of 25 delivered",
        fulfillmentSummaryIsPlaceholder: false,
      })}
    />
  );
  assert.ok(screen.getByText("12 of 25 delivered"));
  assert.equal(
    screen.queryByText("Detailed fulfillment progress is not available yet."),
    null
  );
  cleanup();
});

test("partial payloads omit missing date rows instead of showing broken dates", () => {
  render(
    <PortalOrderDetail
      order={detail({
        createdAt: "",
        submittedAt: "not-a-date",
        activatedAt: null,
        updatedAt: null,
      })}
    />
  );
  assert.equal(screen.queryByText("Dates"), null);
  cleanup();
});
