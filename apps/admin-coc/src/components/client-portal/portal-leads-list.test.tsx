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
  assert.ok(screen.getAllByText("Alex P.").length >= 1);
  assert.ok(screen.getAllByText("Vet Q2").length >= 1);
  assert.ok(screen.getAllByText("Delivered").length >= 1);
  const viewLinks = screen.getAllByRole("link", { name: "View lead" });
  assert.ok(viewLinks.length >= 1);
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/leads/lead_1");
  cleanup();
});
