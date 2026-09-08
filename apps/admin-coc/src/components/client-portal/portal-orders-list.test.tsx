import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { portalOrderDetailFixture, portalOrderFulfillmentAvailable } from "@/lib/client-portal/portal-order-fulfillment-fixtures";

import { PortalOrdersList } from "./portal-orders-list.tsx";

test("shows an empty state when there are no orders", () => {
  render(<PortalOrdersList orders={[]} />);
  assert.ok(screen.getByText("No orders yet"));
  cleanup();
});

test("empty state can link to the order request flow", () => {
  render(<PortalOrdersList orders={[]} placeOrderHref="/portal/orders/new" />);
  const cta = screen.getByRole("link", { name: "Place order" });
  assert.equal(cta.getAttribute("href"), "/portal/orders/new");
  cleanup();
});

test("renders a mapped order row", () => {
  render(
    <PortalOrdersList
      orders={[
        {
          id: "ord_1",
          orderNumber: "LO-1001",
          status: "active",
          nicheLabel: "vet",
          productLabel: "exclusive",
          statesLabel: "TX",
          volume: 10,
          campaignType: "aged",
          destination: "GHL",
          fulfillmentSummary: "In fulfillment",
          setupWarnings: ["GHL destination is not connected"],
          createdAt: new Date().toISOString(),
          paymentConfirmationStatus: "confirmed",
          fulfillment: {
            requestedQuantity: 10,
            fulfilledQuantity: 3,
            remainingQuantity: 7,
            status: "in_progress",
          },
        },
      ]}
    />
  );
  assert.ok(screen.getAllByText("LO-1001").length >= 1);
  assert.ok(screen.getAllByText("Active").length >= 1);
  assert.ok(screen.getAllByText("TX").length >= 1);
  assert.ok(screen.getAllByText("Veteran").length >= 1);
  assert.ok(screen.getAllByText("Exclusive").length >= 1);
  assert.ok(screen.getAllByText("Payment confirmed").length >= 1);
  assert.ok(screen.getAllByText("3 of 10").length >= 1);
  assert.ok(screen.getAllByLabelText("Order status: Active").length >= 1);
  assert.ok(screen.getAllByLabelText("Payment status: Payment confirmed").length >= 1);
  assert.equal(screen.queryByText("vet"), null);
  assert.equal(screen.queryByText("GHL destination is not connected"), null);
  assert.equal(screen.queryByText("GHL SKU"), null);
  const viewLinks = screen.getAllByRole("link", { name: "View order" });
  assert.ok(viewLinks.length >= 1);
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/orders/ord_1");
  cleanup();
});

test("submitted payment pending stays distinct from order status", () => {
  render(
    <PortalOrdersList
      orders={[
        portalOrderDetailFixture({
          id: "ord_pay",
          status: "submitted",
          paymentConfirmationStatus: "pending_confirmation",
          fulfillmentAvailable: false,
          fulfillment: null,
        }),
      ]}
    />
  );
  assert.ok(screen.getAllByLabelText("Order status: Submitted").length >= 1);
  assert.ok(screen.getAllByLabelText("Payment status: Payment pending").length >= 1);
  assert.ok(screen.getAllByText("Payment pending").length >= 1);
  cleanup();
});

test("completed with zero delivered does not invent a released count", () => {
  render(
    <PortalOrdersList
      orders={[
        portalOrderDetailFixture({
          ...portalOrderFulfillmentAvailable(25, 0, 25, "not_started"),
          status: "completed",
          paymentConfirmationStatus: "confirmed",
        }),
      ]}
    />
  );
  assert.ok(screen.getAllByText("Completed").length >= 1);
  assert.ok(screen.getAllByText("0 of 25").length >= 1);
  assert.equal(screen.queryByText("Your spreadsheet is being finalized."), null);
  cleanup();
});

test("mobile cards keep a usable tap target for view order", () => {
  const { container } = render(
    <PortalOrdersList
      orders={[portalOrderDetailFixture({ id: "ord_1" })]}
    />
  );
  assert.ok(container.querySelector("article.md\\:hidden"));
  const viewLinks = screen.getAllByRole("link", { name: "View order" });
  assert.match(viewLinks[0].className, /min-h-10/);
  cleanup();
});

test("order identity includes the client display name and keeps the canonical number", () => {
  render(
    <PortalOrdersList
      displayName="Valley Vet"
      orders={[
        {
          id: "ord_1",
          orderNumber: "LO-2401",
          status: "active",
          nicheLabel: "vet",
          productLabel: "exclusive",
          statesLabel: "TX",
          volume: 10,
          campaignType: "aged",
          destination: "GHL",
          fulfillmentSummary: "In fulfillment",
          setupWarnings: [],
          createdAt: new Date().toISOString(),
        },
      ]}
    />
  );
  assert.ok(screen.getAllByText("Valley Vet").length >= 1);
  assert.ok(screen.getAllByText("LO-2401").length >= 1);
  assert.ok(screen.getAllByText("Aged").length >= 1);
  cleanup();
});
