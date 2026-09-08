import assert from "node:assert/strict";
import test from "node:test";

import {
  clampPublicLeadQuantity,
  createEmptyPublicLeadPreviewDraft,
  publicPreviewContinueHref,
  publicPreviewSummary,
  PUBLIC_PORTAL_INVITE_HREF,
  PUBLIC_PORTAL_PLACE_ORDER_NEXT,
  PUBLIC_PORTAL_SIGN_IN_HREF,
  PUBLIC_REGISTER_HREF,
  PUBLIC_SETUP_HREF,
  PUBLIC_VETERAN_FRESHNESS_OPTIONS,
  togglePublicPreviewState,
} from "./lead-request-preview.ts";

test("preview defaults to Veteran aged inventory without charging", () => {
  const summary = publicPreviewSummary(createEmptyPublicLeadPreviewDraft());
  assert.equal(summary.niche, "Veteran");
  assert.equal(summary.quantity, 100);
  assert.equal(summary.campaignType, "Aged leads");
  assert.match(summary.states, /TX/);
  assert.match(summary.chargeCopy, /not a charge/i);
});

test("freshness options map onto the existing campaignType contract", () => {
  const types = new Set(PUBLIC_VETERAN_FRESHNESS_OPTIONS.map((option) => option.campaignType));
  assert.deepEqual([...types].sort(), ["Aged leads", "Fresh leads"]);
});

test("continue routes to existing portal login with place-order next", () => {
  assert.equal(PUBLIC_PORTAL_SIGN_IN_HREF, "/portal/login");
  assert.equal(PUBLIC_PORTAL_INVITE_HREF, "/portal/invite");
  assert.equal(PUBLIC_REGISTER_HREF, "/get-started/register");
  assert.equal(PUBLIC_SETUP_HREF, "/get-started/setup");
  assert.equal(PUBLIC_PORTAL_PLACE_ORDER_NEXT, "/portal/orders/new");
  assert.equal(
    publicPreviewContinueHref(),
    "/portal/login?next=%2Fportal%2Forders%2Fnew"
  );
});

test("state toggle and quantity stay within the order-create vocabulary", () => {
  assert.deepEqual(togglePublicPreviewState(["TX"], "FL"), ["FL", "TX"]);
  assert.deepEqual(togglePublicPreviewState(["TX", "FL"], "TX"), ["FL"]);
  assert.equal(clampPublicLeadQuantity(0), 1);
  assert.equal(clampPublicLeadQuantity(1_500_000), 1_000_000);
  assert.equal(clampPublicLeadQuantity(Number.NaN), 100);
});
