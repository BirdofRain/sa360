import assert from "node:assert/strict";
import test from "node:test";

import {
  mapClientReleasedDeliveries,
  PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY,
  PORTAL_ORDER_DELIVERY_UNAVAILABLE_COPY,
  portalOrderDeliveryDownloadPath,
  portalOrderDeliveryEmptyCopy,
  portalOrderDeliverySectionState,
} from "./portal-order-deliveries.ts";

const released = {
  id: "pkg_a",
  orderId: "ord_1",
  filename: "Valley-Vet_LO-1001_VET_TX_3-6mo_10-leads.csv",
  displayFilename: "Valley-Vet_LO-1001_VET_TX_3-6mo_10-leads.csv",
  releasedAt: "2026-08-20T15:00:00.000Z",
  leadCount: 10,
  downloadAvailable: true,
};

const readyDelivery = {
  id: "pkg_a",
  orderId: "ord_1",
  filename: "a.csv",
  displayFilename: "a.csv",
  releasedAt: "2026-08-20T15:00:00.000Z",
  leadCount: 1,
  downloadAvailable: true,
  downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_a/download",
};

test("maps released deliveries and drops unreleased or unsafe rows", () => {
  const mapped = mapClientReleasedDeliveries(
    [
      released,
      {
        ...released,
        id: "pkg_b",
        leadCount: 5,
        releasedAt: "2026-08-21T15:00:00.000Z",
      },
      { id: "pkg_hidden", orderId: "ord_1", filename: "secret.csv", downloadAvailable: false },
      { id: "pkg_other", orderId: "ord_other", filename: "x.csv", releasedAt: "2026-08-20T15:00:00.000Z", leadCount: 1, downloadAvailable: true },
      { allocationIds: ["alloc_1"], csvContent: "nope" },
    ],
    "ord_1"
  );
  assert.equal(mapped.length, 2);
  assert.deepEqual(
    mapped.map((row) => row.id),
    ["pkg_a", "pkg_b"]
  );
  assert.equal(mapped[0]?.leadCount, 10);
  assert.equal(mapped[1]?.leadCount, 5);
  assert.equal(
    mapped[0]?.downloadHref,
    portalOrderDeliveryDownloadPath("ord_1", "pkg_a")
  );
  assert.equal(mapped.some((row) => row.id === "pkg_hidden"), false);
});

test("A: completed + released package is ready, never finalizing", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "completed",
      fulfillmentAvailable: true,
      fulfillmentStatus: "fulfilled",
      deliveries: [readyDelivery],
    }),
    "ready"
  );
});

test("B: completed + 0 delivered + no package is empty, not finalizing", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "completed",
      fulfillmentAvailable: true,
      fulfillmentStatus: "not_started",
      deliveries: [],
    }),
    "empty"
  );
  assert.equal(
    portalOrderDeliverySectionState({
      status: "completed",
      fulfillmentAvailable: false,
      fulfillmentStatus: null,
      deliveries: [],
    }),
    "empty"
  );
  assert.equal(
    portalOrderDeliveryEmptyCopy({ status: "completed", fulfilledQuantity: 0 }),
    PORTAL_ORDER_DELIVERY_NOT_RELEASED_COPY
  );
});

test("C: active in-progress with no package is pending empty, not finalizing", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "active",
      fulfillmentAvailable: true,
      fulfillmentStatus: "in_progress",
      deliveries: [],
    }),
    "empty"
  );
  assert.equal(
    portalOrderDeliveryEmptyCopy({ status: "active", fulfilledQuantity: 5 }),
    PORTAL_ORDER_DELIVERY_UNAVAILABLE_COPY
  );
});

test("D: submitted / payment pending stays hidden until delivery is relevant", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "submitted",
      fulfillmentAvailable: false,
      fulfillmentStatus: null,
      deliveries: [],
    }),
    "hidden"
  );
});

test("E: a released package is ready regardless of order lifecycle status", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "submitted",
      fulfillmentAvailable: false,
      fulfillmentStatus: null,
      deliveries: [readyDelivery],
    }),
    "ready"
  );
});

test("finalizing copy requires a real fulfilled + unreleased package state", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "completed",
      fulfillmentAvailable: true,
      fulfillmentStatus: "fulfilled",
      deliveries: [],
    }),
    "finalizing"
  );
  assert.equal(
    portalOrderDeliverySectionState({
      status: "active",
      fulfillmentAvailable: true,
      fulfillmentStatus: "fulfilled",
      deliveries: [],
    }),
    "finalizing"
  );
});

test("delivery lookup errors stay errors and never invent ready or finalizing", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "active",
      fulfillmentAvailable: true,
      fulfillmentStatus: "fulfilled",
      deliveries: [],
      deliveriesError: "failed",
    }),
    "error"
  );
});
