import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { emptyPortalAccountSnapshot } from "@/lib/client-portal/map-client-summary";

import { PortalAccountSnapshot } from "./portal-account-snapshot.tsx";

test("unavailable snapshot does not invent zero counts", () => {
  render(<PortalAccountSnapshot snapshot={emptyPortalAccountSnapshot()} />);
  assert.ok(screen.getByText("Order and lead totals are unavailable right now. Open each page for the latest status."));
  assert.equal(screen.getAllByText("—").length >= 3, true);
  cleanup();
});

test("available snapshot links into orders, leads, and account", () => {
  render(
    <PortalAccountSnapshot
      snapshot={{
        available: true,
        ordersActive: 2,
        ordersNeedingSetup: 1,
        leadsDelivered: 8,
        trustWarnings: 0,
        latestLeadEvent: null,
      }}
    />
  );
  assert.ok(screen.getByRole("link", { name: /Active orders/i }));
  assert.ok(screen.getByRole("link", { name: /Delivered leads/i }));
  assert.ok(screen.getByRole("link", { name: /Account alerts/i }));
  assert.ok(screen.getByText("2"));
  assert.ok(screen.getByText("8"));
  cleanup();
});
