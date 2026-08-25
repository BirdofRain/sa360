import test from "node:test";
import assert from "node:assert/strict";

import {
  formatPortalDate,
  isPortalOrderFulfillmentPlaceholder,
  mapClientLeadOrderDetail,
  mapClientLeadOrderRow,
  mapClientLeadOrderRows,
  PORTAL_ORDER_FULFILLMENT_PLACEHOLDER,
  portalOrderNextStep,
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

test("detail mapper keeps extra customer-safe fields and marks placeholder fulfillment", () => {
  const detail = mapClientLeadOrderDetail({
    id: "ord_1",
    orderNumber: "LO-1001",
    status: "active",
    nicheKey: "vet",
    productType: "exclusive",
    states: ["TX"],
    leadVolume: 25,
    campaignType: "aged",
    deliveryCadence: "weekly",
    crmPackage: "ghl_pro",
    aiVoiceAddon: true,
    notes: "Need Texas coverage",
    fulfillmentSummary: PORTAL_ORDER_FULFILLMENT_PLACEHOLDER,
    setupWarnings: [],
    createdAt: "2026-08-01T12:00:00.000Z",
    submittedAt: "2026-08-01T13:00:00.000Z",
    activatedAt: "2026-08-02T09:00:00.000Z",
    adminNotes: "should be ignored if present",
  });
  assert.ok(detail);
  assert.equal(detail.deliveryCadence, "weekly");
  assert.equal(detail.crmPackage, "ghl pro");
  assert.equal(detail.aiVoiceAddon, true);
  assert.equal(detail.notes, "Need Texas coverage");
  assert.equal(detail.fulfillmentSummaryIsPlaceholder, true);
  assert.equal(detail.states[0], "TX");
});

test("placeholder fulfillment helper treats the backend stock sentence as unavailable", () => {
  assert.equal(isPortalOrderFulfillmentPlaceholder(PORTAL_ORDER_FULFILLMENT_PLACEHOLDER), true);
  assert.equal(isPortalOrderFulfillmentPlaceholder("12 of 25 delivered"), false);
  assert.equal(isPortalOrderFulfillmentPlaceholder(null), true);
});

test("next-step copy is derived from status without ETAs", () => {
  assert.match(portalOrderNextStep({ status: "submitted", setupWarnings: [] }), /submitted/i);
  assert.match(portalOrderNextStep({ status: "active", setupWarnings: [] }), /active/i);
  assert.ok(!portalOrderNextStep({ status: "active", setupWarnings: [] }).includes("ETA"));
  assert.equal(
    portalOrderNextStep({ status: "needs_setup", setupWarnings: ["Need a workflow"] }),
    "Need a workflow"
  );
});

test("formatPortalDate omits invalid values", () => {
  assert.equal(formatPortalDate(null), null);
  assert.equal(formatPortalDate("not-a-date"), null);
  assert.ok(formatPortalDate("2026-08-01T12:00:00.000Z"));
});

test("detail mapper returns null for malformed payloads", () => {
  assert.equal(mapClientLeadOrderDetail({ id: "x" }), null);
  assert.equal(mapClientLeadOrderDetail(null), null);
});
