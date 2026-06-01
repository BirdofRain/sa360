import test from "node:test";
import assert from "node:assert/strict";

/** Mirrors API slug rule for clientAccountId. */
function isValidClientAccountId(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value) && value.length >= 2;
}

test("clientAccountId slug validation accepts breanna_kimberling shape", () => {
  assert.equal(isValidClientAccountId("breanna_kimberling"), true);
});

test("clientAccountId slug validation rejects uppercase and spaces", () => {
  assert.equal(isValidClientAccountId("Breanna"), false);
  assert.equal(isValidClientAccountId("bad id"), false);
});
