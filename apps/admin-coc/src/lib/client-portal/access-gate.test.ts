import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPortalAccessSession,
  hasPortalSession,
  isClientPortalAccessGateRequired,
  isValidPortalAccessCode,
  resolvePortalRenderMode,
} from "./access-gate.ts";
import { createPortalSessionToken } from "./portal-session.ts";

test("resolvePortalRenderMode: mock when API not configured", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: false,
      hasSession: false,
      loginConfigured: false,
      gateRequired: false,
    }),
    "mock"
  );
});

test("resolvePortalRenderMode: login_required when live and login configured without session", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      hasSession: false,
      loginConfigured: true,
      gateRequired: false,
    }),
    "login_required"
  );
});

test("resolvePortalRenderMode: access_gate when live gate required without session", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      hasSession: false,
      loginConfigured: false,
      gateRequired: true,
    }),
    "access_gate"
  );
});

test("resolvePortalRenderMode: live when session valid", () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "gate-test-secret";
  const token = createPortalSessionToken({
    clientAccountId: "acct_gate",
    clientDisplayName: "Gate Client",
    portalDisplayName: null,
    portalLoginEmail: "gate@example.com",
  });
  assert.ok(token);
  assert.equal(hasPortalSession(token), true);
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      hasSession: true,
      loginConfigured: true,
      gateRequired: true,
    }),
    "live"
  );
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("isValidPortalAccessCode uses timing-safe compare", () => {
  const prev = process.env.CLIENT_PORTAL_ACCESS_CODE;
  process.env.CLIENT_PORTAL_ACCESS_CODE = "invite-demo-2026";
  assert.equal(isValidPortalAccessCode("invite-demo-2026"), true);
  assert.equal(isValidPortalAccessCode("wrong"), false);
  if (prev !== undefined) process.env.CLIENT_PORTAL_ACCESS_CODE = prev;
  else delete process.env.CLIENT_PORTAL_ACCESS_CODE;
});

test("isClientPortalAccessGateRequired needs API and access code without login env", () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevA = process.env.CLIENT_PORTAL_ACCESS_CODE;
  const prevE = process.env.CLIENT_PORTAL_LOGIN_EMAIL;

  delete process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.CLIENT_PORTAL_ACCESS_CODE;
  assert.equal(isClientPortalAccessGateRequired(), false);

  process.env.CLIENT_PORTAL_API_KEY = "key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://localhost:3001";
  process.env.CLIENT_PORTAL_ACCESS_CODE = "secret";
  delete process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  delete process.env.CLIENT_PORTAL_SESSION_SECRET;
  assert.equal(isClientPortalAccessGateRequired(), true);

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_ACCESS_CODE = prevA;
  else delete process.env.CLIENT_PORTAL_ACCESS_CODE;
  if (prevE !== undefined) process.env.CLIENT_PORTAL_LOGIN_EMAIL = prevE;
});

test("hasPortalAccessSession accepts legacy cookie marker only", () => {
  assert.equal(hasPortalAccessSession("granted"), true);
  assert.equal(hasPortalAccessSession(undefined), false);
});
