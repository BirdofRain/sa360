import test from "node:test";
import assert from "node:assert/strict";

import {
  CLIENT_LEAD_ORDER_FULFILLMENT_UNAVAILABLE_SUMMARY,
  presentLeadOrderFulfillment,
  presentLeadOrderFulfillmentSummary,
} from "./lead-order-fulfillment.present.js";

test("legacy/unavailable: null requestedQuantity and zero committed allocations", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 150,
    requestedQuantity: null,
    committedAllocationCount: 0,
  });
  assert.equal(fulfillment, null);
  assert.equal(
    presentLeadOrderFulfillmentSummary(fulfillment),
    CLIENT_LEAD_ORDER_FULFILLMENT_UNAVAILABLE_SUMMARY
  );
});

test("zero fulfilled when tracking is configured", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 25,
    requestedQuantity: 25,
    committedAllocationCount: 0,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 0,
    remainingQuantity: 25,
    status: "not_started",
  });
  assert.equal(presentLeadOrderFulfillmentSummary(fulfillment), "0 of 25 delivered");
});

test("partially fulfilled uses committed allocation count", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 25,
    requestedQuantity: 25,
    committedAllocationCount: 5,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 5,
    remainingQuantity: 20,
    status: "in_progress",
  });
  assert.equal(presentLeadOrderFulfillmentSummary(fulfillment), "5 of 25 delivered");
});

test("PPL E2E shape: requested 5 / committed 2 stays allocation-derived", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 5,
    requestedQuantity: 5,
    committedAllocationCount: 2,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 5,
    fulfilledQuantity: 2,
    remainingQuantity: 3,
    status: "in_progress",
  });
  assert.equal(presentLeadOrderFulfillmentSummary(fulfillment), "2 of 5 delivered");
});

test("fully fulfilled", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 10,
    requestedQuantity: 10,
    committedAllocationCount: 10,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 10,
    fulfilledQuantity: 10,
    remainingQuantity: 0,
    status: "fulfilled",
  });
});

test("over-fulfillment never returns negative remaining", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 10,
    requestedQuantity: 10,
    committedAllocationCount: 12,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 10,
    fulfilledQuantity: 12,
    remainingQuantity: 0,
    status: "fulfilled",
  });
});

test("falls back to leadVolume when requestedQuantity is unset but allocations exist", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 40,
    requestedQuantity: null,
    committedAllocationCount: 3,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 40,
    fulfilledQuantity: 3,
    remainingQuantity: 37,
    status: "in_progress",
  });
});

test("invalid requested quantity is unavailable rather than a fake zero", () => {
  assert.equal(
    presentLeadOrderFulfillment({
      leadVolume: 0,
      requestedQuantity: 0,
      committedAllocationCount: 0,
    }),
    null
  );
  assert.equal(
    presentLeadOrderFulfillment({
      leadVolume: -5,
      requestedQuantity: -1,
      committedAllocationCount: 0,
    }),
    null
  );
});

test("negative committed count is treated as zero fulfilled when tracking is configured", () => {
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 8,
    requestedQuantity: 8,
    committedAllocationCount: -3,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 8,
    fulfilledQuantity: 0,
    remainingQuantity: 8,
    status: "not_started",
  });
});
