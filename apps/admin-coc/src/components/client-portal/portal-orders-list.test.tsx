import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalOrdersList } from "./portal-orders-list.tsx";

test("shows an empty state when there are no orders", () => {
  render(<PortalOrdersList orders={[]} />);
  assert.ok(screen.getByText("No orders yet"));
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
          setupWarnings: [],
          createdAt: new Date().toISOString(),
        },
      ]}
    />
  );
  assert.ok(screen.getAllByText("LO-1001").length >= 1);
  assert.ok(screen.getAllByText("Active").length >= 1);
  assert.ok(screen.getAllByText("TX").length >= 1);
  assert.ok(screen.getAllByText("Veteran").length >= 1);
  assert.ok(screen.getAllByText("Exclusive").length >= 1);
  assert.equal(screen.queryByText("vet"), null);
  const viewLinks = screen.getAllByRole("link", { name: "View order" });
  assert.ok(viewLinks.length >= 1);
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/orders/ord_1");
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
