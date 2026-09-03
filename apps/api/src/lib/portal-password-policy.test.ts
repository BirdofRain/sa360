import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePortalPasswordConfirmation,
  evaluatePortalPasswordPolicy,
  PORTAL_PASSWORD_MAX_LENGTH,
  PORTAL_PASSWORD_MIN_LENGTH,
  PORTAL_PASSWORD_MISMATCH,
  PORTAL_PASSWORD_POLICY_COPY,
} from "@sa360/shared";

test("portal password policy is length-only (10–128) with no composition rules", () => {
  assert.equal(PORTAL_PASSWORD_MIN_LENGTH, 10);
  assert.equal(PORTAL_PASSWORD_MAX_LENGTH, 128);
  assert.ok(PORTAL_PASSWORD_POLICY_COPY.includes("10 to 128"));
  assert.ok(PORTAL_PASSWORD_POLICY_COPY.toLowerCase().includes("optional"));

  assert.equal(evaluatePortalPasswordPolicy("a".repeat(9)).ok, false);
  assert.equal(evaluatePortalPasswordPolicy("a".repeat(10)).ok, true);
  assert.equal(evaluatePortalPasswordPolicy("all-lowercase").ok, true);
  assert.equal(evaluatePortalPasswordPolicy("a".repeat(128)).ok, true);
  assert.equal(evaluatePortalPasswordPolicy("a".repeat(129)).ok, false);
  assert.equal(evaluatePortalPasswordPolicy("").ok, false);

  const rejected = evaluatePortalPasswordPolicy("tooshort");
  if (!rejected.ok) {
    assert.equal(rejected.error.includes("secret-too"), false);
  }
});

test("password confirmation rejects mismatch before policy and does not echo either value", () => {
  const mismatch = evaluatePortalPasswordConfirmation("long-enough-password", "other-password-xx");
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.error, PORTAL_PASSWORD_MISMATCH);
    assert.equal(mismatch.error.includes("long-enough-password"), false);
    assert.equal(mismatch.error.includes("other-password-xx"), false);
  }
  assert.equal(evaluatePortalPasswordConfirmation("long-enough-password", "long-enough-password").ok, true);
  assert.equal(evaluatePortalPasswordConfirmation("short", "short").ok, false);
  assert.equal(evaluatePortalPasswordConfirmation("x".repeat(129), "x".repeat(129)).ok, false);
});
