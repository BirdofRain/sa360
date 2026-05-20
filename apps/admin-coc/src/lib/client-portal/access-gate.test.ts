import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPortalAccessSession,
  isClientPortalAccessGateRequired,
  isValidPortalAccessCode,
  resolvePortalRenderMode,
} from "./access-gate.ts";

test("resolvePortalRenderMode: mock when API not configured", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: false,
      gateRequired: false,
      hasAccess: false,
    }),
    "mock"
  );
});

test("resolvePortalRenderMode: access_gate when live gate required without session", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      gateRequired: true,
      hasAccess: false,
    }),
    "access_gate"
  );
});

test("resolvePortalRenderMode: live when gate required and access granted", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      gateRequired: true,
      hasAccess: true,
    }),
    "live"
  );
});

test("resolvePortalRenderMode: live when API configured but gate not required", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      gateRequired: false,
      hasAccess: false,
    }),
    "live"
  );
});

test("isValidPortalAccessCode uses timing-safe compare", () => {
  const prev = process.env.CLIENT_PORTAL_ACCESS_CODE;
  process.env.CLIENT_PORTAL_ACCESS_CODE = "invite-demo-2026";
  assert.equal(isValidPortalAccessCode("invite-demo-2026"), true);
  assert.equal(isValidPortalAccessCode("wrong"), false);
  if (prev !== undefined) process.env.CLIENT_PORTAL_ACCESS_CODE = prev;
  else delete process.env.CLIENT_PORTAL_ACCESS_CODE;
});

test("isClientPortalAccessGateRequired needs API base, key, and access code", () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevA = process.env.CLIENT_PORTAL_ACCESS_CODE;

  delete process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.CLIENT_PORTAL_ACCESS_CODE;
  assert.equal(isClientPortalAccessGateRequired(), false);

  process.env.CLIENT_PORTAL_API_KEY = "key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://localhost:3001";
  process.env.CLIENT_PORTAL_ACCESS_CODE = "secret";
  assert.equal(isClientPortalAccessGateRequired(), true);

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_ACCESS_CODE = prevA;
  else delete process.env.CLIENT_PORTAL_ACCESS_CODE;
});

test("hasPortalAccessSession accepts canonical cookie marker only", () => {
  assert.equal(hasPortalAccessSession("granted"), true);
  assert.equal(hasPortalAccessSession(undefined), false);
  assert.equal(hasPortalAccessSession("ok"), false);
});
