import test from "node:test";
import assert from "node:assert/strict";
import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import {
  hasPortalSession,
  isClientPortalAccessGateRequired,
  portalLoginPath,
  resolvePortalRenderMode,
} from "./access-gate.ts";
import { isClientPortalLoginConfigured } from "./portal-auth.ts";
import { guardClientPortalBffSession, portalBffHasBrowserTenantOverride } from "./portal-bff-auth.ts";
import { createPortalSessionToken } from "./portal-session.ts";
import {
  PORTAL_LOGIN_INVALID_CREDENTIALS,
  PORTAL_LOGIN_TITLE,
  resolvePortalLoginPageRedirect,
} from "./portal-login-flow.ts";

test("login page title and invalid credential copy are client-facing", () => {
  assert.equal(PORTAL_LOGIN_TITLE, "Sign in to your dashboard");
  assert.ok(!PORTAL_LOGIN_INVALID_CREDENTIALS.includes("ADMIN"));
  assert.ok(!PORTAL_LOGIN_INVALID_CREDENTIALS.includes("stack"));
});

test("authenticated user on login page redirects to portal", () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "flow-test-secret";
  const token = createPortalSessionToken({
    clientAccountId: "acct_flow",
    clientDisplayName: "Flow Client",
    portalDisplayName: null,
    portalLoginEmail: "flow@example.com",
  });
  assert.ok(token);
  const target = resolvePortalLoginPageRedirect({
    apiConfigured: true,
    sessionCookie: token,
    nextPath: "/portal?range=30d",
  });
  assert.equal(target, "/portal?range=30d");
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("live mode without session resolves to login_required when login configured", () => {
  const prevE = process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_LOGIN_EMAIL = "a@b.co";
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "pw";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "sec";
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      hasSession: false,
      loginConfigured: isClientPortalLoginConfigured(),
      gateRequired: false,
    }),
    "login_required"
  );
  if (prevE !== undefined) process.env.CLIENT_PORTAL_LOGIN_EMAIL = prevE;
  else delete process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("portalLoginPath encodes next for /portal", () => {
  assert.equal(portalLoginPath("/portal?range=7d"), "/portal/login?next=%2Fportal%3Frange%3D7d");
});

test("BFF returns 401 without session when live API configured", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_API_KEY = "key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://localhost:3001";
  assert.equal(isClientPortalApiConfigured(), true);
  const res = await guardClientPortalBffSession(undefined);
  assert.ok(res);
  assert.equal(res.status, 401);
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});

test("BFF allows request with valid signed session when live configured", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_API_KEY = "key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://localhost:3001";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "bff-session-secret";
  const token = createPortalSessionToken({
    clientAccountId: "acct_bff",
    clientDisplayName: "BFF Client",
    portalDisplayName: null,
    portalLoginEmail: "bff@example.com",
    portalSessionEpoch: 0,
  });
  assert.ok(token);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        clientAccountId: "acct_bff",
        portalSessionEpoch: 0,
        portalEnabled: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
  assert.equal(await guardClientPortalBffSession(token), null);
  assert.equal(hasPortalSession(token), true);
  globalThis.fetch = originalFetch;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("mock preview mode skips BFF session guard", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  assert.equal(await guardClientPortalBffSession(undefined), null);
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
});

test("access gate only when live, access code set, login not configured", () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevA = process.env.CLIENT_PORTAL_ACCESS_CODE;
  const prevE = process.env.CLIENT_PORTAL_LOGIN_EMAIL;
  process.env.CLIENT_PORTAL_API_KEY = "key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://localhost:3001";
  process.env.CLIENT_PORTAL_ACCESS_CODE = "invite";
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

test("epoch match allows BFF session; incremented epoch invalidates old session", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_API_KEY = "key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://localhost:3001";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "bff-session-secret";
  const oldToken = createPortalSessionToken({
    clientAccountId: "acct_bff",
    clientDisplayName: "BFF Client",
    portalDisplayName: null,
    portalLoginEmail: "bff@example.com",
    portalSessionEpoch: 0,
  });
  const newToken = createPortalSessionToken({
    clientAccountId: "acct_bff",
    clientDisplayName: "BFF Client",
    portalDisplayName: null,
    portalLoginEmail: "bff@example.com",
    portalSessionEpoch: 1,
  });
  assert.ok(oldToken && newToken);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        clientAccountId: "acct_bff",
        portalSessionEpoch: 1,
        portalEnabled: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const denied = await guardClientPortalBffSession(oldToken);
  assert.ok(denied);
  assert.equal(denied.status, 401);

  assert.equal(await guardClientPortalBffSession(newToken), null);

  globalThis.fetch = originalFetch;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("browser-supplied clientAccountId still cannot switch tenant", () => {
  const hijack = new URLSearchParams({ range: "7d", clientAccountId: "acct_other" });
  assert.equal(portalBffHasBrowserTenantOverride(hijack), true);
  const sessionScoped = new URLSearchParams({ range: "7d" });
  assert.equal(portalBffHasBrowserTenantOverride(sessionScoped), false);
});

