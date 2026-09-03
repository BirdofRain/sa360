import test from "node:test";
import assert from "node:assert/strict";
import { PORTAL_PASSWORD_RESET_GENERIC_SUCCESS } from "@sa360/shared";
import {
  PORTAL_FORGOT_PASSWORD_EMAIL_LABEL,
  PORTAL_FORGOT_PASSWORD_LINK,
  PORTAL_FORGOT_PASSWORD_PATH,
  PORTAL_FORGOT_PASSWORD_SUBMIT,
  PORTAL_FORGOT_PASSWORD_TITLE,
  PORTAL_PASSWORD_RESET_GENERIC,
  portalForgotPasswordEmailValue,
} from "./portal-password-reset-flow.ts";

test("forgot-password copy is generic and does not mention tenants or the shared password", () => {
  assert.equal(PORTAL_FORGOT_PASSWORD_PATH, "/portal/forgot-password");
  assert.equal(PORTAL_FORGOT_PASSWORD_LINK, "Forgot password?");
  assert.equal(PORTAL_FORGOT_PASSWORD_TITLE, "Reset your password");
  assert.equal(PORTAL_FORGOT_PASSWORD_EMAIL_LABEL, "Portal login email");
  assert.equal(PORTAL_FORGOT_PASSWORD_SUBMIT, "Send reset link");
  assert.equal(PORTAL_PASSWORD_RESET_GENERIC, PORTAL_PASSWORD_RESET_GENERIC_SUCCESS);
  assert.ok(PORTAL_PASSWORD_RESET_GENERIC.toLowerCase().includes("if that email"));
  assert.equal(PORTAL_PASSWORD_RESET_GENERIC.toLowerCase().includes("tenant"), false);
  assert.equal(PORTAL_PASSWORD_RESET_GENERIC.includes("acct_"), false);
  assert.equal(PORTAL_PASSWORD_RESET_GENERIC.toLowerCase().includes("shared"), false);
});

test("portalForgotPasswordEmailValue trims submitted email and does not invent an account id", () => {
  const form = new FormData();
  form.set("email", "  Customer@Example.COM  ");
  assert.equal(portalForgotPasswordEmailValue(form), "Customer@Example.COM");
  assert.equal(form.has("clientAccountId"), false);
});
