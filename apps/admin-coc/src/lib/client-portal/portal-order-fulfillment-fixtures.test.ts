import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePortalOrderFulfillmentPreviewScenario,
  portalOrderFulfillmentPreviewProps,
} from "./portal-order-fulfillment-fixtures.ts";

test("preview scenarios cover the required local fulfillment fixtures", () => {
  const zero = portalOrderFulfillmentPreviewProps("zero");
  assert.equal(zero.order.fulfillment?.fulfilledQuantity, 0);
  assert.equal(zero.order.fulfillment?.requestedQuantity, 25);
  assert.equal(zero.linkedLeads.length, 0);

  const partial = portalOrderFulfillmentPreviewProps("partial");
  assert.equal(partial.order.fulfillment?.fulfilledQuantity, 5);
  assert.equal(partial.order.fulfillment?.remainingQuantity, 20);

  const full = portalOrderFulfillmentPreviewProps("full");
  assert.equal(full.order.fulfillment?.fulfilledQuantity, 25);
  assert.equal(full.order.fulfillment?.status, "fulfilled");

  const unavailable = portalOrderFulfillmentPreviewProps("unavailable");
  assert.equal(unavailable.order.fulfillmentAvailable, false);
  assert.equal(unavailable.order.fulfillment, null);

  const linked = portalOrderFulfillmentPreviewProps("linked");
  assert.equal(linked.linkedLeads.length, 2);
  assert.equal(linked.linkedLeads[0]?.phoneMasked?.includes("+1"), false);

  const failed = portalOrderFulfillmentPreviewProps("leads_error");
  assert.equal(failed.linkedLeadsError, "Order leads could not be loaded.");
  assert.equal(failed.order.fulfillmentAvailable, true);

  const released = portalOrderFulfillmentPreviewProps("released");
  assert.equal(released.deliveries.length, 1);
  assert.equal(released.deliveries[0]?.downloadAvailable, true);

  const multiple = portalOrderFulfillmentPreviewProps("released_multiple");
  assert.equal(multiple.deliveries.length, 2);
  assert.equal(multiple.deliveries[1]?.leadCount, 5);
});

test("unknown preview scenario falls back to partial fulfillment", () => {
  assert.equal(parsePortalOrderFulfillmentPreviewScenario(undefined), "partial");
  assert.equal(parsePortalOrderFulfillmentPreviewScenario("nope"), "partial");
  assert.equal(parsePortalOrderFulfillmentPreviewScenario("zero"), "zero");
});
