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
  assert.ok(screen.getByText("LO-1001"));
  assert.ok(screen.getByText("Active"));
  assert.ok(screen.getByText("TX"));
  cleanup();
});
