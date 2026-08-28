import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePortalJourneyPreviewScenario,
  portalJourneyPreviewModel,
} from "./portal-journey-fixtures.ts";

test("preview fixtures cover the customer-safe next-action states", () => {
  assert.equal(portalJourneyPreviewModel("onboarding").hero.kind, "complete_account");
  assert.equal(portalJourneyPreviewModel("no_order").hero.kind, "place_first_order");
  assert.equal(portalJourneyPreviewModel("payment_pending").hero.kind, "payment_pending");
  assert.equal(portalJourneyPreviewModel("submitted_confirmed").hero.kind, "order_review");
  assert.equal(portalJourneyPreviewModel("approved").hero.kind, "order_approved");
  assert.equal(portalJourneyPreviewModel("active_zero").hero.fulfillmentLabel, "0 of 25 delivered");
  assert.equal(portalJourneyPreviewModel("active_partial").hero.fulfillmentLabel, "17 of 25 delivered");
  assert.equal(portalJourneyPreviewModel("fulfilled").hero.kind, "order_finalizing");
  assert.equal(portalJourneyPreviewModel("completed").hero.kind, "order_complete");
  assert.equal(portalJourneyPreviewModel("multiple").hero.orderNumber, "LO-2500");
  assert.equal(portalJourneyPreviewModel("multiple").recentOrders.length, 2);
  assert.equal(portalJourneyPreviewModel("account_error").hero.kind, "account_unavailable");
  assert.equal(portalJourneyPreviewModel("account_error").recentOrders.length, 1);
  assert.equal(portalJourneyPreviewModel("orders_error").hero.kind, "orders_unavailable");
  assert.notEqual(portalJourneyPreviewModel("orders_error").hero.kind, "place_first_order");
});

test("unknown preview scenario falls back to partial fulfillment", () => {
  assert.equal(parsePortalJourneyPreviewScenario(undefined), "active_partial");
  assert.equal(parsePortalJourneyPreviewScenario("nope"), "active_partial");
  assert.equal(parsePortalJourneyPreviewScenario("payment_pending"), "payment_pending");
});
