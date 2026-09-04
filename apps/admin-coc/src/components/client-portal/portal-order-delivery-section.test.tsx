import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import {
  PORTAL_ORDER_DELIVERY_FINALIZING_COPY,
  PORTAL_ORDER_DELIVERY_LOAD_ERROR,
  PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY,
  PORTAL_ORDER_DELIVERY_READY_COPY,
  PORTAL_ORDER_DELIVERY_UNAVAILABLE_COPY,
  type PortalOrderDelivery,
} from "@/lib/client-portal/portal-order-deliveries";
import { portalOrderDetailFixture, portalOrderFulfillmentAvailable } from "@/lib/client-portal/portal-order-fulfillment-fixtures";

import { PortalOrderDeliverySection } from "./portal-order-delivery-section.tsx";

function delivery(overrides: Partial<PortalOrderDelivery> = {}): PortalOrderDelivery {
  return {
    id: "pkg_a",
    orderId: "ord_1001",
    filename: "Valley-Vet_LO-1001_VET_TX_3-6mo_10-leads.csv",
    displayFilename: "Valley-Vet_LO-1001_VET_TX_3-6mo_10-leads.csv",
    releasedAt: "2026-08-20T15:00:00.000Z",
    leadCount: 10,
    downloadAvailable: true,
    downloadHref: "/api/client-portal/orders/ord_1001/exports/pkg_a/download",
    ...overrides,
  };
}

test("active in-progress with no package does not claim the spreadsheet is being finalized", () => {
  render(
    <PortalOrderDeliverySection
      order={portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress"))}
      deliveries={[]}
    />
  );
  assert.ok(screen.getByText(PORTAL_ORDER_DELIVERY_UNAVAILABLE_COPY));
  assert.equal(screen.queryByText(PORTAL_ORDER_DELIVERY_FINALIZING_COPY), null);
  assert.equal(screen.queryByText(PORTAL_ORDER_DELIVERY_READY_COPY), null);
  assert.equal(screen.queryByRole("link", { name: "Download spreadsheet" }), null);
  cleanup();
});

test("completed + 0 delivered + no package is truthful and not finalizing", () => {
  render(
    <PortalOrderDeliverySection
      order={portalOrderDetailFixture({
        ...portalOrderFulfillmentAvailable(25, 0, 25, "not_started"),
        status: "completed",
      })}
      deliveries={[]}
    />
  );
  assert.ok(screen.getByText(PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY));
  assert.equal(screen.queryByText(PORTAL_ORDER_DELIVERY_FINALIZING_COPY), null);
  assert.equal(screen.queryByRole("link", { name: "Download spreadsheet" }), null);
  cleanup();
});

test("shows finalizing copy only when fulfillment is complete and no package is released", () => {
  render(
    <PortalOrderDeliverySection
      order={portalOrderDetailFixture({
        ...portalOrderFulfillmentAvailable(25, 25, 0, "fulfilled"),
        status: "completed",
      })}
      deliveries={[]}
    />
  );
  assert.ok(screen.getByText(PORTAL_ORDER_DELIVERY_FINALIZING_COPY));
  assert.equal(screen.queryByText(PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY), null);
  cleanup();
});

test("shows each released delivery with date, count, and download", () => {
  render(
    <PortalOrderDeliverySection
      order={portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 15, 10, "in_progress"))}
      deliveries={[
        delivery(),
        delivery({
          id: "pkg_b",
          displayFilename: "Valley-Vet_LO-1001_VET_TX_3-6mo_5-leads.csv",
          releasedAt: "2026-08-21T15:00:00.000Z",
          leadCount: 5,
          downloadHref: "/api/client-portal/orders/ord_1001/exports/pkg_b/download",
        }),
      ]}
    />
  );
  assert.ok(screen.getByText(PORTAL_ORDER_DELIVERY_READY_COPY));
  assert.equal(screen.queryByText(PORTAL_ORDER_DELIVERY_FINALIZING_COPY), null);
  const links = screen.getAllByRole("link", { name: "Download spreadsheet" });
  assert.equal(links.length, 2);
  assert.equal(links[0]?.getAttribute("href"), "/api/client-portal/orders/ord_1001/exports/pkg_a/download");
  assert.equal(links[1]?.getAttribute("href"), "/api/client-portal/orders/ord_1001/exports/pkg_b/download");
  assert.ok(screen.getByText(/10 leads/));
  assert.ok(screen.getByText(/5 leads/));
  cleanup();
});

test("does not invent unreleased package metadata on load error", () => {
  render(
    <PortalOrderDeliverySection
      order={portalOrderDetailFixture(portalOrderFulfillmentAvailable(25, 5, 20, "in_progress"))}
      deliveriesError="failed"
    />
  );
  assert.ok(screen.getByText(PORTAL_ORDER_DELIVERY_LOAD_ERROR));
  assert.equal(screen.queryByText(PORTAL_ORDER_DELIVERY_READY_COPY), null);
  assert.equal(screen.queryByText("pkg_unreleased"), null);
  cleanup();
});
