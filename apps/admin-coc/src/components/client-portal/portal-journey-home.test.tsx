import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import {
  buildPortalJourneyHome,
  PORTAL_JOURNEY_COPY,
} from "../../lib/client-portal/portal-journey.ts";

import { PortalJourneyHome } from "./portal-journey-home.tsx";

const readyAccount = {
  clientDisplayName: "Northwind",
  portalDisplayName: "Northwind",
  portalLoginEmail: "alex@example.com",
  primaryNicheKeys: ["vet"],
  primaryProductTypes: ["aged"],
  status: "active" as const,
  profileComplete: true,
  readyToOrder: true,
  missingFields: [] as [],
};

const baseOrder = {
  id: "ord_1",
  orderNumber: "LO-2418",
  status: "submitted" as const,
  nicheLabel: "vet",
  productLabel: "aged",
  statesLabel: "TX",
  volume: 25,
  campaignType: "aged",
  destination: "GHL",
  fulfillmentSummary: null,
  setupWarnings: [] as string[],
  createdAt: "2026-08-20T12:00:00.000Z",
  paymentConfirmationStatus: "pending_confirmation" as const,
  fulfillment: null,
};

test("incomplete onboarding hero shows continue setup", () => {
  const model = buildPortalJourneyHome({
    account: {
      ok: true,
      value: { ...readyAccount, status: "onboarding", readyToOrder: false },
    },
    orders: { ok: true, value: [] },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "Complete your account" }));
  assert.equal(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href"), "/portal/account");
  cleanup();
});

test("ready account with no orders shows place-order CTA", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: { ok: true, value: [] },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "Place your first order" }));
  assert.equal(screen.getByRole("link", { name: "Place order" }).getAttribute("href"), "/portal/orders/new");
  assert.ok(screen.getByText(PORTAL_JOURNEY_COPY.recentOrdersEmpty));
  cleanup();
});

test("payment pending shows order identity and no payment CTA", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: { ok: true, value: [{ ...baseOrder }] },
  });
  render(<PortalJourneyHome model={model} displayName="Northwind" />);
  assert.ok(screen.getByRole("heading", { name: "Awaiting payment confirmation" }));
  assert.ok(screen.getAllByText("LO-2418").length >= 1);
  assert.ok(screen.getByText("We'll begin fulfillment after payment is confirmed."));
  assert.equal(screen.queryByRole("link", { name: "Continue setup" }), null);
  assert.equal(screen.queryByRole("link", { name: "Place order" }), null);
  cleanup();
});

test("in-progress partial fulfillment shows count and view-order CTA", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          status: "active",
          paymentConfirmationStatus: "confirmed",
          fulfillment: {
            requestedQuantity: 25,
            fulfilledQuantity: 17,
            remainingQuantity: 8,
            status: "in_progress",
          },
        },
      ],
    },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "Your order is in progress" }));
  assert.ok(screen.getByText("17 of 25 delivered"));
  assert.equal(screen.getByRole("link", { name: "View order" }).getAttribute("href"), "/portal/orders/ord_1");
  cleanup();
});

test("fulfilled order does not invent a ready-to-download state", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          status: "active",
          paymentConfirmationStatus: "confirmed",
          releasedDeliveries: [],
          fulfillment: {
            requestedQuantity: 25,
            fulfilledQuantity: 25,
            remainingQuantity: 0,
            status: "fulfilled",
          },
        },
      ],
    },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "We're finalizing your delivery" }));
  assert.equal(screen.queryByRole("heading", { name: "Your order is ready" }), null);
  cleanup();
});

test("orders failure is not rendered as no orders yet", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: { ok: false },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "We couldn't load your orders." }));
  assert.ok(screen.getByText(PORTAL_JOURNEY_COPY.recentOrdersUnavailable));
  assert.equal(screen.queryByText("No orders yet"), null);
  assert.equal(screen.queryByRole("heading", { name: "Place your first order" }), null);
  cleanup();
});

test("account failure keeps recent orders when that list loaded", () => {
  const model = buildPortalJourneyHome({
    account: { ok: false },
    orders: { ok: true, value: [{ ...baseOrder }] },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "We couldn't load your account status." }));
  assert.ok(screen.getAllByText("LO-2418").length >= 1);
  assert.ok(screen.getByRole("link", { name: "View all orders" }));
  cleanup();
});

test("multiple orders stay visible under the hero", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          id: "ord_new",
          orderNumber: "LO-2500",
          status: "active",
          paymentConfirmationStatus: "confirmed",
          createdAt: "2026-08-22T00:00:00.000Z",
          fulfillment: {
            requestedQuantity: 25,
            fulfilledQuantity: 4,
            remainingQuantity: 21,
            status: "in_progress",
          },
        },
        {
          ...baseOrder,
          id: "ord_old",
          orderNumber: "LO-2400",
          status: "completed",
          paymentConfirmationStatus: "confirmed",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "Your order is in progress" }));
  assert.ok(screen.getAllByText("LO-2500").length >= 1);
  assert.ok(screen.getByText("LO-2400"));
  assert.ok(screen.getByText("In progress"));
  assert.ok(screen.getByText("Complete"));
  assert.equal(screen.queryByText("Active"), null);
  assert.equal(screen.queryByText("Ready"), null);
  cleanup();
});

test("one released delivery shows a download CTA and Delivery ready label", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          status: "active",
          paymentConfirmationStatus: "confirmed",
          fulfillment: {
            requestedQuantity: 25,
            fulfilledQuantity: 25,
            remainingQuantity: 0,
            status: "fulfilled",
          },
          releasedDeliveries: [
            {
              id: "pkg_1",
              orderId: "ord_1",
              filename: "Northwind_LO-2418.csv",
              displayFilename: "Northwind_LO-2418.csv",
              releasedAt: "2026-08-22T15:00:00.000Z",
              leadCount: 25,
              downloadAvailable: true,
              downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_1/download",
            },
          ],
        },
      ],
    },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "Your order is ready" }));
  assert.ok(screen.getByText("Your spreadsheet is ready to download."));
  const cta = screen.getByRole("link", { name: "Download spreadsheet" });
  assert.equal(cta.getAttribute("href"), "/api/client-portal/orders/ord_1/exports/pkg_1/download");
  assert.match(cta.className, /min-h-11/);
  assert.match(cta.className, /w-full/);
  assert.ok(screen.getByText("Delivery ready"));
  cleanup();
});

test("multiple released deliveries use View deliveries instead of a multi-download hero", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          status: "active",
          paymentConfirmationStatus: "confirmed",
          releasedDeliveries: [
            {
              id: "pkg_1",
              orderId: "ord_1",
              filename: "a.csv",
              displayFilename: "a.csv",
              releasedAt: "2026-08-22T15:00:00.000Z",
              leadCount: 10,
              downloadAvailable: true,
              downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_1/download",
            },
            {
              id: "pkg_2",
              orderId: "ord_1",
              filename: "b.csv",
              displayFilename: "b.csv",
              releasedAt: "2026-08-23T15:00:00.000Z",
              leadCount: 15,
              downloadAvailable: true,
              downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_2/download",
            },
          ],
        },
      ],
    },
  });
  render(<PortalJourneyHome model={model} />);
  assert.equal(screen.getByRole("link", { name: "View deliveries" }).getAttribute("href"), "/portal/orders/ord_1");
  assert.equal(screen.queryByRole("link", { name: "Download spreadsheet" }), null);
  cleanup();
});

test("delivery lookup failure keeps order progress and does not fabricate ready or finalizing", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          status: "active",
          paymentConfirmationStatus: "confirmed",
          releasedDeliveriesFailed: true,
          fulfillment: {
            requestedQuantity: 25,
            fulfilledQuantity: 25,
            remainingQuantity: 0,
            status: "fulfilled",
          },
        },
      ],
    },
  });
  render(<PortalJourneyHome model={model} />);
  assert.ok(screen.getByRole("heading", { name: "Your order is in progress" }));
  assert.ok(screen.getAllByText("LO-2418").length >= 1);
  assert.ok(screen.getByText("In progress"));
  assert.equal(screen.queryByRole("heading", { name: "Your order is ready" }), null);
  assert.equal(screen.queryByRole("heading", { name: "We're finalizing your delivery" }), null);
  assert.equal(screen.queryByText("Delivery ready"), null);
  cleanup();
});

test("place first order CTA lands on the order-request route", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: { ok: true, value: [] },
  });
  render(<PortalJourneyHome model={model} />);
  assert.equal(screen.getByRole("link", { name: "Place order" }).getAttribute("href"), "/portal/orders/new");
  cleanup();
});

test("ready-state CTA stays full-width at 390px with no overflow-prone hero text", () => {
  const model = buildPortalJourneyHome({
    account: { ok: true, value: readyAccount },
    orders: {
      ok: true,
      value: [
        {
          ...baseOrder,
          status: "active",
          paymentConfirmationStatus: "confirmed",
          releasedDeliveries: [
            {
              id: "pkg_1",
              orderId: "ord_1",
              filename: "Northwind_LO-2418.csv",
              displayFilename: "Northwind_LO-2418.csv",
              releasedAt: "2026-08-22T15:00:00.000Z",
              leadCount: 25,
              downloadAvailable: true,
              downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_1/download",
            },
          ],
        },
      ],
    },
  });
  const { container } = render(<PortalJourneyHome model={model} />);
  const cta = screen.getByRole("link", { name: "Download spreadsheet" });
  assert.match(cta.className, /min-h-11/);
  assert.match(cta.className, /w-full/);
  assert.match(cta.className, /md:w-auto/);
  const textCol = container.querySelector("section .min-w-0");
  assert.ok(textCol);
  cleanup();
});

test("desktop and mobile hero share one stacked layout with a full-width CTA", () => {
  const model = buildPortalJourneyHome({
    account: {
      ok: true,
      value: { ...readyAccount, status: "onboarding", readyToOrder: false },
    },
    orders: { ok: true, value: [] },
  });
  const { container } = render(<PortalJourneyHome model={model} />);
  const cta = screen.getByRole("link", { name: "Continue setup" });
  assert.match(cta.className, /min-h-11/);
  assert.match(cta.className, /w-full/);
  assert.match(cta.className, /md:w-auto/);
  const row = container.querySelector("section .flex.flex-col");
  assert.ok(row);
  assert.match(row?.className ?? "", /md:flex-row/);
  cleanup();
});
