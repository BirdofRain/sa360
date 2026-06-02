import test from "node:test";
import assert from "node:assert/strict";
import {
  ghlConnectionStatusLabel,
  validateLinkClientAccountId,
} from "./ghl-connection-display.ts";

test("ghlConnectionStatusLabel formats status", () => {
  assert.equal(ghlConnectionStatusLabel("connected"), "connected");
});

test("validateLinkClientAccountId rejects empty", () => {
  assert.equal(validateLinkClientAccountId(""), "Client account ID is required.");
  assert.equal(validateLinkClientAccountId("  client_1  "), null);
});
