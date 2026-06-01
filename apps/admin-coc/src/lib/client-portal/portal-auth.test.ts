import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticatePortalLogin,
  isClientPortalLoginConfigured,
  normalizePortalLoginEmail,
  PORTAL_LOGIN_DISABLED,
  verifyClientPortalPassword,
} from "./portal-auth.ts";

test("verifyClientPortalPassword accepts env password", () => {
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "portal-pass-2026";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "secret-for-login-check";
  assert.equal(isClientPortalLoginConfigured(), true);
  assert.equal(verifyClientPortalPassword("portal-pass-2026"), true);
  assert.equal(verifyClientPortalPassword("wrong"), false);
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("authenticatePortalLogin uses env fallback when API has no match", async () => {
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  const prevE = process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "portal-pass";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "secret";
  process.env.CLIENT_PORTAL_LOGIN_EMAIL = "legacy@example.com";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_legacy";
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  delete process.env.CLIENT_PORTAL_API_KEY;

  const result = await authenticatePortalLogin("legacy@example.com", "portal-pass");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.session.clientAccountId, "acct_legacy");
    assert.equal(result.session.portalLoginEmail, "legacy@example.com");
  }

  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
  if (prevE !== undefined) process.env.CLIENT_PORTAL_LOGIN_EMAIL = prevE;
  else delete process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
});

test("normalizePortalLoginEmail lowercases and trims", () => {
  assert.equal(normalizePortalLoginEmail("  User@Co.COM "), "user@co.com");
});

test("PORTAL_LOGIN_DISABLED copy is client-safe", () => {
  assert.ok(PORTAL_LOGIN_DISABLED.includes("not enabled"));
  assert.ok(!PORTAL_LOGIN_DISABLED.includes("ADMIN"));
});
