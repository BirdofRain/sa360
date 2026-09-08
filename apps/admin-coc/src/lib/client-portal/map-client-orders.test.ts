import test from "node:test";
import assert from "node:assert/strict";

import {
  formatPortalDate,
  isPortalOrderFulfillmentPlaceholder,
  mapClientLeadOrderDetail,
  mapClientLeadOrderRow,
  mapClientLeadOrderRows,
  PORTAL_ORDER_FULFILLMENT_PLACEHOLDER,
  portalCustomerVisibleWarnings,
  portalOrderDeliveredCountLabel,
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
      paymentConfirmationStatus: "confirmed",
      fulfillmentAvailable: true,
      fulfillment: {
        requestedQuantity: 25,
        fulfilledQuantity: 5,
        remainingQuantity: 20,
        status: "in_progress",
      },
    },
    { id: "bad", status: "not-a-status" },
    null,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderNumber, "LO-1001");
  assert.equal(rows[0].statesLabel, "TX, OK");
  assert.equal(rows[0].nicheLabel, "vet");
  assert.equal(rows[0].setupWarnings[0], "Destination still needs a workflow");
  assert.equal(rows[0].paymentConfirmationStatus, "confirmed");
  assert.deepEqual(rows[0].fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 5,
    remainingQuantity: 20,
    status: "in_progress",
  });
});

test("does not invent paymentConfirmationStatus when the client API omitted it", () => {
  const row = mapClientLeadOrderRow({
    id: "ord_2",
    orderNumber: "LO-1002",
    status: "submitted",
    nicheKey: "vet",
    leadVolume: 10,
    campaignType: "aged",
    createdAt: "2026-08-01T12:00:00.000Z",
  });
  assert.equal(row?.paymentConfirmationStatus, null);
  assert.equal(row?.fulfillment, null);
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
  assert.equal(detail.fulfillmentAvailable, false);
  assert.equal(detail.fulfillment, null);
  assert.equal(detail.states[0], "TX");
});

test("detail mapper exposes PR #86 fulfillment only when available", () => {
  const detail = mapClientLeadOrderDetail({
    id: "ord_1",
    orderNumber: "LO-1001",
    status: "active",
    nicheKey: "vet",
    leadVolume: 25,
    campaignType: "aged",
    fulfillmentAvailable: true,
    fulfillmentSummary: "5 of 25 delivered",
    fulfillment: {
      requestedQuantity: 25,
      fulfilledQuantity: 5,
      remainingQuantity: 20,
      status: "in_progress",
      reservedQuantity: 4,
    },
    reservedQuantity: 4,
    proposedQuantity: 2,
    setupWarnings: [],
    createdAt: "2026-08-01T12:00:00.000Z",
  });
  assert.ok(detail);
  assert.equal(detail.fulfillmentAvailable, true);
  assert.deepEqual(detail.fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 5,
    remainingQuantity: 20,
    status: "in_progress",
  });
  assert.equal(detail.fulfillmentSummaryIsPlaceholder, false);
  assert.equal(Object.hasOwn(detail.fulfillment ?? {}, "reservedQuantity"), false);
});

test("detail mapper ignores structured fulfillment when the backend says it is unavailable", () => {
  const detail = mapClientLeadOrderDetail({
    id: "ord_1",
    orderNumber: "LO-1001",
    status: "active",
    nicheKey: "vet",
    leadVolume: 25,
    campaignType: "aged",
    fulfillmentAvailable: false,
    fulfillmentSummary: PORTAL_ORDER_FULFILLMENT_PLACEHOLDER,
    fulfillment: {
      requestedQuantity: 25,
      fulfilledQuantity: 0,
      remainingQuantity: 25,
      status: "not_started",
    },
    setupWarnings: [],
    createdAt: "2026-08-01T12:00:00.000Z",
  });
  assert.ok(detail);
  assert.equal(detail.fulfillmentAvailable, false);
  assert.equal(detail.fulfillment, null);
  assert.equal(detail.fulfillmentSummaryIsPlaceholder, true);
});

test("placeholder fulfillment helper treats the backend stock sentence as unavailable", () => {
  assert.equal(isPortalOrderFulfillmentPlaceholder(PORTAL_ORDER_FULFILLMENT_PLACEHOLDER), true);
  assert.equal(isPortalOrderFulfillmentPlaceholder("12 of 25 delivered"), false);
  assert.equal(isPortalOrderFulfillmentPlaceholder(null), true);
});

test("next-step copy is derived from status without ETAs or operator warnings", () => {
  assert.match(portalOrderNextStep({ status: "submitted", setupWarnings: [] }), /submitted/i);
  assert.match(
    portalOrderNextStep({
      status: "submitted",
      paymentConfirmationStatus: "pending_confirmation",
    }),
    /payment/i
  );
  assert.match(portalOrderNextStep({ status: "active", setupWarnings: [] }), /in progress/i);
  assert.ok(!portalOrderNextStep({ status: "active", setupWarnings: [] }).includes("ETA"));
  assert.equal(
    portalOrderNextStep({ status: "needs_setup", setupWarnings: ["Need a workflow"] }),
    "Account setup is still needed before this order can begin."
  );
  assert.ok(
    !portalOrderNextStep({
      status: "needs_setup",
      setupWarnings: ["GHL destination is not connected"],
    }).includes("GHL")
  );
});

test("customer-visible warnings drop GHL and operator implementation text", () => {
  assert.deepEqual(
    portalCustomerVisibleWarnings([
      "Your order is waiting on account setup before work can begin.",
      "GHL destination is not connected",
      "Destination still needs a workflow",
      "Need a GHL SKU",
    ]),
    ["Your order is waiting on account setup before work can begin."]
  );
});

test("delivered count label uses fulfillment data and is not invented", () => {
  assert.equal(portalOrderDeliveredCountLabel({ fulfillment: null }), null);
  assert.equal(
    portalOrderDeliveredCountLabel({
      fulfillment: {
        requestedQuantity: 25,
        fulfilledQuantity: 5,
        remainingQuantity: 20,
        status: "in_progress",
      },
    }),
    "5 of 25"
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
