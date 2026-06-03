import test from "node:test";
import assert from "node:assert/strict";
import {
  ghlConnectionStatusLabel,
  ghlDeliveryReadinessLabel,
  ghlOAuthBannerBorderClass,
  isGhlDeliverableConnection,
  validateLinkClientAccountId,
} from "./ghl-connection-display.ts";

test("ghlConnectionStatusLabel formats status", () => {
  assert.equal(ghlConnectionStatusLabel("connected"), "connected");
  assert.equal(ghlConnectionStatusLabel("pending_location"), "pending location");
});

test("ghlDeliveryReadinessLabel maps readiness hints", () => {
  assert.equal(ghlDeliveryReadinessLabel("ready_for_delivery_config"), "Ready for delivery config");
  assert.equal(ghlDeliveryReadinessLabel("not_delivery_capable"), "Not delivery-capable");
});

test("isGhlDeliverableConnection only allows connected status", () => {
  assert.equal(isGhlDeliverableConnection("connected"), true);
  assert.equal(isGhlDeliverableConnection("pending_location"), false);
});

test("validateLinkClientAccountId rejects empty", () => {
  assert.equal(validateLinkClientAccountId(""), "Client account ID is required.");
  assert.equal(validateLinkClientAccountId("  client_1  "), null);
});

test("ghlOAuthBannerBorderClass returns classes per tone", () => {
  assert.match(ghlOAuthBannerBorderClass("success"), /emerald/);
  assert.match(ghlOAuthBannerBorderClass("error"), /destructive/);
});
