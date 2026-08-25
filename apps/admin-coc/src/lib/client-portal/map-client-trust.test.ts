import test from "node:test";
import assert from "node:assert/strict";

import {
  mapClientTrustCenter,
  portalTrustStatusLabel,
  portalTrustStatusTone,
} from "./map-client-trust.ts";

test("maps trust cards and skips incomplete rows", () => {
  const view = mapClientTrustCenter({
    generatedAt: "2026-08-25T12:00:00.000Z",
    cards: [
      {
        key: "ghl_connection",
        title: "CRM connection",
        status: "verified",
        summary: "Your CRM location is connected.",
        warnings: [],
      },
      { title: "Missing key" },
    ],
  });
  assert.ok(view);
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].statusLabel, "Verified");
});

test("returns null for non-objects", () => {
  assert.equal(mapClientTrustCenter(null), null);
});

test("trust status labels stay customer-facing", () => {
  assert.equal(portalTrustStatusLabel("needs_setup"), "Needs setup");
  assert.equal(portalTrustStatusTone("failed"), "bad");
});
