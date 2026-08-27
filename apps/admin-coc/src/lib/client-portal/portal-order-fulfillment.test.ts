import assert from "node:assert/strict";
import test from "node:test";

import {
  mapPortalOrderFulfillment,
  portalFulfillmentPrimarySummary,
  portalFulfillmentProgressPercent,
  portalFulfillmentStatusLabel,
  portalFulfillmentStatusTone,
} from "./portal-order-fulfillment.ts";

function available(overrides: Record<string, unknown> = {}) {
  return {
    fulfillmentAvailable: true,
    fulfillment: {
      requestedQuantity: 25,
      fulfilledQuantity: 5,
      remainingQuantity: 20,
      status: "in_progress",
      reservedQuantity: 8,
      proposedQuantity: 3,
      storedFulfilledQuantity: 2,
      ...overrides,
    },
    reservedQuantity: 99,
    proposedQuantity: 88,
  };
}

test("maps fulfillment only when available and the object is valid", () => {
  const mapped = mapPortalOrderFulfillment(available());
  assert.deepEqual(mapped, {
    requestedQuantity: 25,
    fulfilledQuantity: 5,
    remainingQuantity: 20,
    status: "in_progress",
  });
  assert.equal(Object.hasOwn(mapped ?? {}, "reservedQuantity"), false);
  assert.equal(Object.hasOwn(mapped ?? {}, "proposedQuantity"), false);
});

test("treats fulfillment as unavailable when the flag is missing or false", () => {
  assert.equal(
    mapPortalOrderFulfillment({
      fulfillmentAvailable: false,
      fulfillment: {
        requestedQuantity: 25,
        fulfilledQuantity: 0,
        remainingQuantity: 25,
        status: "not_started",
      },
    }),
    null
  );
  assert.equal(
    mapPortalOrderFulfillment({
      fulfillment: {
        requestedQuantity: 25,
        fulfilledQuantity: 5,
        remainingQuantity: 20,
        status: "in_progress",
      },
    }),
    null
  );
});

test("rejects a zero or missing requested quantity even if the flag is true", () => {
  assert.equal(mapPortalOrderFulfillment(available({ requestedQuantity: 0 })), null);
  assert.equal(mapPortalOrderFulfillment({ fulfillmentAvailable: true, fulfillment: null }), null);
  assert.equal(
    mapPortalOrderFulfillment(available({ status: "reserved", fulfilledQuantity: 0 })),
    null
  );
});

test("customer status labels stay explicit", () => {
  assert.equal(portalFulfillmentStatusLabel("not_started"), "Not started");
  assert.equal(portalFulfillmentStatusLabel("in_progress"), "In progress");
  assert.equal(portalFulfillmentStatusLabel("fulfilled"), "Fulfilled");
  assert.equal(portalFulfillmentStatusTone("not_started"), "neutral");
  assert.equal(portalFulfillmentStatusTone("in_progress"), "warn");
  assert.equal(portalFulfillmentStatusTone("fulfilled"), "good");
});

test("progress percent is presentation-only and caps over-fulfillment", () => {
  assert.equal(
    portalFulfillmentProgressPercent({
      requestedQuantity: 25,
      fulfilledQuantity: 0,
      remainingQuantity: 25,
      status: "not_started",
    }),
    0
  );
  assert.equal(
    portalFulfillmentProgressPercent({
      requestedQuantity: 25,
      fulfilledQuantity: 5,
      remainingQuantity: 20,
      status: "in_progress",
    }),
    20
  );
  assert.equal(
    portalFulfillmentProgressPercent({
      requestedQuantity: 25,
      fulfilledQuantity: 25,
      remainingQuantity: 0,
      status: "fulfilled",
    }),
    100
  );
  assert.equal(
    portalFulfillmentProgressPercent({
      requestedQuantity: 25,
      fulfilledQuantity: 30,
      remainingQuantity: 0,
      status: "fulfilled",
    }),
    100
  );
});

test("primary summary uses authoritative counts", () => {
  assert.equal(
    portalFulfillmentPrimarySummary({
      requestedQuantity: 25,
      fulfilledQuantity: 0,
      remainingQuantity: 25,
      status: "not_started",
    }),
    "0 of 25 delivered"
  );
  assert.equal(
    portalFulfillmentPrimarySummary({
      requestedQuantity: 25,
      fulfilledQuantity: 30,
      remainingQuantity: 0,
      status: "fulfilled",
    }),
    "30 of 25 delivered"
  );
});
