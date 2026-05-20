import test from "node:test";
import assert from "node:assert/strict";
import {
  isClientPortalLoginConfigured,
  normalizePortalLoginEmail,
  verifyClientPortalCredentials,
} from "./portal-auth.ts";

test("verifyClientPortalCredentials accepts matching email and password", () => {
  const prevE = process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_LOGIN_EMAIL = "Client@Example.com";
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "portal-pass-2026";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "secret-for-login-check";
  assert.equal(isClientPortalLoginConfigured(), true);
  assert.equal(
    verifyClientPortalCredentials("client@example.com", "portal-pass-2026"),
    true
  );
  assert.equal(verifyClientPortalCredentials("client@example.com", "wrong"), false);
  if (prevE !== undefined) process.env.CLIENT_PORTAL_LOGIN_EMAIL = prevE;
  else delete process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("normalizePortalLoginEmail lowercases and trims", () => {
  assert.equal(normalizePortalLoginEmail("  User@Co.COM "), "user@co.com");
});
