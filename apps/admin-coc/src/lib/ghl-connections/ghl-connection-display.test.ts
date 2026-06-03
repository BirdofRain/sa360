import test from "node:test";
import assert from "node:assert/strict";
import {
  ghlConnectionStatusLabel,
  isGhlDeliverableConnection,
  validateLinkClientAccountId,
} from "./ghl-connection-display.ts";

test("ghlConnectionStatusLabel formats status", () => {
  assert.equal(ghlConnectionStatusLabel("connected"), "connected");
  assert.equal(ghlConnectionStatusLabel("pending_location"), "pending location");
});

test("isGhlDeliverableConnection only allows connected", () => {
  assert.equal(isGhlDeliverableConnection("connected"), true);
  assert.equal(isGhlDeliverableConnection("pending_location"), false);
  assert.equal(isGhlDeliverableConnection("pending_token"), false);
});

test("validateLinkClientAccountId rejects empty", () => {
  assert.equal(validateLinkClientAccountId(""), "Client account ID is required.");
  assert.equal(validateLinkClientAccountId("  client_1  "), null);
});
