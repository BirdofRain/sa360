import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalLeadsList } from "./portal-leads-list.tsx";

test("shows an empty state when there are no leads", () => {
  render(<PortalLeadsList leads={[]} />);
  assert.ok(screen.getByText("No delivered leads yet"));
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
  assert.ok(screen.getByText("Alex P."));
  assert.ok(screen.getByText("Vet Q2"));
  assert.ok(screen.getByText("Delivered"));
  cleanup();
});
