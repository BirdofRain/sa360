import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePortalPasswordPolicy,
  PORTAL_PASSWORD_MAX_LENGTH,
  PORTAL_PASSWORD_MIN_LENGTH,
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
