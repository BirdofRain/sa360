import test from "node:test";
import assert from "node:assert/strict";
import { PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";
import {
  evaluateInvitePassword,
  evaluateInvitePasswordConfirmation,
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_INVALID,
  PORTAL_INVITE_POLICY_COPY,
  PORTAL_INVITE_SUCCESS_LOGIN_PATH,
  PORTAL_INVITE_TITLE,
  PORTAL_PASSWORD_CONFIRM_MISMATCH,
  portalInvitePageState,
  preparePortalInviteAccept,
} from "./portal-invite-flow.ts";

test("invite copy is customer-safe and documents the length policy", () => {
  assert.equal(PORTAL_INVITE_TITLE, "Choose a new password for your portal");
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

test("preparePortalInviteAccept requires matching confirmation and does not keep confirmPassword", () => {
  const token = "a".repeat(43);
  const mismatch = new FormData();
  mismatch.set("token", token);
  mismatch.set("password", "long-enough-password");
  mismatch.set("confirmPassword", "different-password");
  const blocked = preparePortalInviteAccept(mismatch);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error, PORTAL_PASSWORD_CONFIRM_MISMATCH);
    assert.equal(JSON.stringify(blocked).includes("long-enough-password"), false);
    assert.equal(JSON.stringify(blocked).includes("different-password"), false);
    assert.equal(JSON.stringify(blocked).includes("confirmPassword"), false);
  }

  const tooShort = new FormData();
  tooShort.set("token", token);
  tooShort.set("password", "short");
  tooShort.set("confirmPassword", "short");
  const policy = preparePortalInviteAccept(tooShort);
  assert.equal(policy.ok, false);
  if (!policy.ok) {
    assert.equal(policy.error, PORTAL_PASSWORD_POLICY_COPY);
    assert.equal(policy.error.includes("short"), false);
  }

  const tooLong = new FormData();
  tooLong.set("token", token);
  tooLong.set("password", "x".repeat(129));
  tooLong.set("confirmPassword", "x".repeat(129));
  assert.equal(preparePortalInviteAccept(tooLong).ok, false);

  const ok = new FormData();
  ok.set("token", token);
  ok.set("password", "long-enough-password");
  ok.set("confirmPassword", "long-enough-password");
  const prepared = preparePortalInviteAccept(ok);
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.token, token);
    assert.equal(prepared.password, "long-enough-password");
    assert.equal("confirmPassword" in prepared, false);
    assert.equal(JSON.stringify(prepared).includes("confirmPassword"), false);
  }

  const mismatchCheck = evaluateInvitePasswordConfirmation("long-enough-password", "nope");
  assert.equal(mismatchCheck.ok, false);
  if (!mismatchCheck.ok) {
    assert.equal(mismatchCheck.error, PORTAL_PASSWORD_CONFIRM_MISMATCH);
  }
});
