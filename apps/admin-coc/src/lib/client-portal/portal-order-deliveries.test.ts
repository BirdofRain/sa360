import assert from "node:assert/strict";
import test from "node:test";

import {
  mapClientReleasedDeliveries,
  portalOrderDeliveryDownloadPath,
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

test("delivery section stays hidden until fulfillment or a released package exists", () => {
  assert.equal(
    portalOrderDeliverySectionState({
      status: "submitted",
      fulfillmentAvailable: false,
      deliveries: [],
    }),
    "hidden"
  );
  assert.equal(
    portalOrderDeliverySectionState({
      status: "active",
      fulfillmentAvailable: true,
      deliveries: [],
    }),
    "finalizing"
  );
  assert.equal(
    portalOrderDeliverySectionState({
      status: "submitted",
      fulfillmentAvailable: false,
      deliveries: [
        {
          id: "pkg_a",
          orderId: "ord_1",
          filename: "a.csv",
          displayFilename: "a.csv",
          releasedAt: "2026-08-20T15:00:00.000Z",
          leadCount: 1,
          downloadAvailable: true,
          downloadHref: "/api/client-portal/orders/ord_1/exports/pkg_a/download",
        },
      ],
    }),
    "ready"
  );
  assert.equal(
    portalOrderDeliverySectionState({
      status: "active",
      fulfillmentAvailable: true,
      deliveries: [],
      deliveriesError: "failed",
    }),
    "error"
  );
});
