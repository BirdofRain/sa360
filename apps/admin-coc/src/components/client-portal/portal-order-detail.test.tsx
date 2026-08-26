import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_ORDER_FULFILLMENT_PLACEHOLDER } from "@/lib/client-portal/map-client-orders";
import {
  portalOrderDetailFixture,
  portalOrderFulfillmentAvailable,
  PORTAL_ORDER_LINKED_LEAD_FIXTURES,
} from "@/lib/client-portal/portal-order-fulfillment-fixtures";
import { PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE } from "@/lib/client-portal/portal-order-leads-api";

import { PortalOrderDetail } from "./portal-order-detail.tsx";

function detail(
  overrides: Partial<ReturnType<typeof portalOrderDetailFixture>> = {}
) {
  return portalOrderDetailFixture({
    id: "ord_1",
    statesLabel: "TX",
    ...overrides,
  });
}

test("renders customer-safe detail and back navigation", () => {
  render(<PortalOrderDetail order={detail()} />);
  assert.ok(screen.getByRole("heading", { name: "LO-1001" }));
  assert.ok(screen.getByRole("link", { name: "Back to Orders" }));
  assert.ok(screen.getByText("Active"));
  assert.ok(screen.getByText("25"));
  assert.ok(screen.getByText("TX"));
  assert.ok(screen.getByText("OK"));
  assert.ok(screen.getByText("Veteran"));
  assert.ok(screen.getByText("Exclusive"));
  assert.ok(screen.getByText("Aged"));
  assert.ok(screen.getByText("Weekly"));
  assert.equal(screen.queryByText("vet"), null);
  assert.ok(screen.getByText("Detailed fulfillment progress is not available yet."));
  assert.equal(screen.queryByText(PORTAL_ORDER_FULFILLMENT_PLACEHOLDER), null);
  assert.ok(screen.getByText(PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE));
  assert.equal(screen.queryByRole("link", { name: "View account leads" }), null);
  cleanup();
});

test("order header identity includes the client display name and keeps the canonical number", () => {
  render(<PortalOrderDetail order={detail({ orderNumber: "LO-2401" })} displayName="Valley Vet" />);
  assert.ok(screen.getByRole("heading", { name: /Valley Vet/ }));
  assert.ok(screen.getByRole("heading", { name: /LO-2401/ }));
  assert.ok(screen.getByText("LO-2401"));
  cleanup();
});

test("status pill stays compact on the order detail header", () => {
  const { container } = render(<PortalOrderDetail order={detail()} />);
  const pill = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === "Active");
  assert.ok(pill);
  assert.match(pill.className, /w-fit/);
  assert.match(pill.className, /self-start/);
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

test("shows 0 of 25 when fulfillment is available and nothing has been delivered", () => {
  render(
    <PortalOrderDetail order={detail(portalOrderFulfillmentAvailable(25, 0, 25, "not_started"))} />
  );
  assert.ok(screen.getByText("0 of 25 delivered"));
  assert.ok(screen.getByText("Not started"));
  assert.ok(screen.getByText("Ordered"));
  assert.equal(screen.getAllByText("25").length >= 2, true);
  assert.ok(screen.getByText("Delivered"));
  assert.ok(screen.getByText("0"));
  assert.ok(screen.getByText("Remaining"));
  assert.equal(screen.queryByText("Detailed fulfillment progress is not available yet."), null);
  cleanup();
});

test("shows partial fulfillment as 5 of 25 with an in-progress status", () => {
  render(
    <PortalOrderDetail order={detail(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress"))} />
  );
  assert.ok(screen.getByText("5 of 25 delivered"));
  assert.ok(screen.getByText("In progress"));
  assert.ok(screen.getByText("5"));
  assert.ok(screen.getByText("20"));
  assert.equal(screen.queryByText("20%"), null);
  assert.equal(screen.queryByText("Reserved"), null);
  assert.equal(screen.queryByText("Proposed"), null);
  assert.equal(screen.queryByText(/ETA/i), null);
  cleanup();
});

test("shows full fulfillment as 25 of 25", () => {
  render(
    <PortalOrderDetail order={detail(portalOrderFulfillmentAvailable(25, 25, 0, "fulfilled"))} />
  );
  assert.ok(screen.getByText("25 of 25 delivered"));
  assert.ok(screen.getByText("Fulfilled"));
  cleanup();
});

test("caps the progress bar on defensive over-fulfillment", () => {
  const { container } = render(
    <PortalOrderDetail order={detail(portalOrderFulfillmentAvailable(25, 30, 0, "fulfilled"))} />
  );
  assert.ok(screen.getByText("30 of 25 delivered"));
  const bar = container.querySelector("[role='progressbar']");
  assert.ok(bar);
  assert.equal(bar.getAttribute("aria-valuenow"), "100");
  const fill = bar.querySelector("div");
  assert.ok(fill);
  assert.match(fill.getAttribute("style") ?? "", /width:\s*100%/);
  assert.match(bar.className, /overflow-hidden/);
  assert.match(bar.className, /max-w-full/);
  cleanup();
});

test("does not invent 0 delivered when fulfillment is unavailable", () => {
  render(
    <PortalOrderDetail
      order={detail({
        fulfillmentSummary: "12 of 25 delivered",
        fulfillmentSummaryIsPlaceholder: false,
        fulfillmentAvailable: false,
        fulfillment: null,
      })}
    />
  );
  assert.ok(screen.getByText("Detailed fulfillment progress is not available yet."));
  assert.equal(screen.queryByText("12 of 25 delivered"), null);
  assert.equal(screen.queryByText("0 of 25 delivered"), null);
  cleanup();
});

test("renders order-linked leads with a View lead path and masked contact only", () => {
  render(
    <PortalOrderDetail
      order={detail(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress"))}
      linkedLeads={PORTAL_ORDER_LINKED_LEAD_FIXTURES}
    />
  );
  assert.ok(screen.getAllByText("Leads from this order").length >= 1);
  assert.ok(screen.getAllByText("Alex P.").length >= 1);
  assert.ok(screen.getAllByText("(•••) •••-1212").length >= 1);
  const viewLinks = screen.getAllByRole("link", { name: "View lead" });
  assert.ok(viewLinks.length >= 1);
  assert.equal(viewLinks[0].getAttribute("href"), "/portal/leads/lead_alex");
  assert.equal(screen.queryByText("+1555121212"), null);
  assert.equal(screen.queryByText("alex@example.com"), null);
  assert.equal(screen.queryByText("alloc_secret"), null);
  assert.equal(screen.queryByText("ghl_secret"), null);
  cleanup();
});

test("shows an honest empty state when fulfillment exists but no leads are linked", () => {
  render(
    <PortalOrderDetail
      order={detail(portalOrderFulfillmentAvailable(25, 0, 25, "not_started"))}
      linkedLeads={[]}
    />
  );
  assert.ok(screen.getByText(PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE));
  assert.equal(screen.queryByText("Delivered leads are not linked to individual orders yet."), null);
  cleanup();
});

test("keeps order detail usable when linked leads fail to load", () => {
  render(
    <PortalOrderDetail
      order={detail(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress"))}
      linkedLeadsError="Order leads could not be loaded."
    />
  );
  assert.ok(screen.getByRole("heading", { name: "LO-1001" }));
  assert.ok(screen.getByText("5 of 25 delivered"));
  assert.ok(screen.getByText("Order leads could not be loaded."));
  assert.equal(screen.queryByText(PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE), null);
  assert.equal(screen.queryByText("Order could not be loaded"), null);
  cleanup();
});

test("fulfillment counts and lead rows stay mobile-safe", () => {
  const { container } = render(
    <PortalOrderDetail
      order={detail(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress"))}
      linkedLeads={PORTAL_ORDER_LINKED_LEAD_FIXTURES}
    />
  );
  assert.ok(container.querySelector("dl.grid.grid-cols-1.sm\\:grid-cols-3"));
  assert.ok(container.querySelector("article.md\\:hidden"));
  const viewLinks = screen.getAllByRole("link", { name: "View lead" });
  assert.match(viewLinks[0].className, /min-h-10/);
  assert.match(viewLinks[0].className, /min-w-\[44px\]/);
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
