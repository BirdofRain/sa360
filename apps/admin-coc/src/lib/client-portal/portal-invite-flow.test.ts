import test from "node:test";
import assert from "node:assert/strict";
import { PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";
import {
  evaluateInvitePassword,
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_INVALID,
  PORTAL_INVITE_POLICY_COPY,
  PORTAL_INVITE_SUCCESS_LOGIN_PATH,
  PORTAL_INVITE_TITLE,
  portalInvitePageState,
} from "./portal-invite-flow.ts";

test("invite copy is customer-safe and documents the length policy", () => {
  assert.equal(PORTAL_INVITE_TITLE, "Set your portal password");
  assert.equal(PORTAL_INVITE_POLICY_COPY, PORTAL_PASSWORD_POLICY_COPY);
  assert.ok(PORTAL_INVITE_POLICY_COPY.includes("10 to 128"));
  assert.ok(!PORTAL_INVITE_INVALID.toLowerCase().includes("tenant"));
  assert.ok(!PORTAL_INVITE_INVALID.toLowerCase().includes("hash"));
  assert.ok(!PORTAL_INVITE_INVALID.includes("acct_"));
  assert.equal(PORTAL_INVITE_SUCCESS_LOGIN_PATH, "/portal/login?passwordSet=1");
});

test("malformed tokens show the generic invalid state without hitting accept", () => {
  assert.equal(portalInvitePageState(undefined), "invalid");
  assert.equal(portalInvitePageState(""), "invalid");
  assert.equal(portalInvitePageState("short"), "invalid");
  assert.equal(portalInvitePageState("a".repeat(43)), "form");
  assert.equal(isWellFormedPortalInviteToken("a".repeat(43)), true);
});

test("password policy failures do not echo the rejected password", () => {
  const tooShort = evaluateInvitePassword("secret");
  assert.equal(tooShort.ok, false);
  if (!tooShort.ok) {
    assert.equal(tooShort.error.includes("secret"), false);
    assert.equal(tooShort.error, PORTAL_PASSWORD_POLICY_COPY);
  }
  assert.equal(evaluateInvitePassword("long-enough-password").ok, true);
  assert.equal(evaluateInvitePassword("x".repeat(129)).ok, false);
});
