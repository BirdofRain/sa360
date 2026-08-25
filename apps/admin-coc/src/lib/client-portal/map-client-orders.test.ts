import test from "node:test";
import assert from "node:assert/strict";

import {
  mapClientLeadOrderRow,
  mapClientLeadOrderRows,
  portalOrderStatusLabel,
  portalOrderStatusTone,
} from "./map-client-orders.ts";

test("maps a client lead-order row and drops malformed items", () => {
  const rows = mapClientLeadOrderRows([
    {
      id: "ord_1",
      orderNumber: "LO-1001",
      status: "active",
      nicheKey: "vet",
      productType: "exclusive",
      states: ["TX", "OK"],
      leadVolume: 25,
      campaignType: "aged",
      deliveryDestinationLabel: "GHL location",
      fulfillmentSummary: "5 of 25 delivered",
      setupWarnings: ["Destination still needs a workflow"],
      createdAt: "2026-08-01T12:00:00.000Z",
    },
    { id: "bad", status: "not-a-status" },
    null,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderNumber, "LO-1001");
  assert.equal(rows[0].statesLabel, "TX, OK");
  assert.equal(rows[0].nicheLabel, "vet");
  assert.equal(rows[0].setupWarnings[0], "Destination still needs a workflow");
});

test("rejects rows without a known status", () => {
  assert.equal(mapClientLeadOrderRow({ id: "x" }), null);
});

test("order status labels stay customer-facing", () => {
  assert.equal(portalOrderStatusLabel("needs_setup"), "Needs setup");
  assert.equal(portalOrderStatusLabel("needs_compliance"), "Needs review");
  assert.equal(portalOrderStatusTone("active"), "good");
  assert.equal(portalOrderStatusTone("canceled"), "bad");
});
