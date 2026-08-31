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
    assert.equal(result.session.portalSessionEpoch, 0);
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("authenticatePortalLogin: hashed customer password works and env password fails", async () => {
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "secret";
  process.env.CLIENT_PORTAL_API_KEY = "portal-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://portal-api.test";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/client/v1/portal-login") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        loginEmail?: string;
        password?: string;
      };
      assert.equal(typeof body.password, "string");
      if (body.password === "acct-a-unique-pass" && body.loginEmail === "a@example.com") {
        return jsonResponse(200, {
          ok: true,
          passwordCheck: "customer",
          portalSessionEpoch: 2,
          context: {
            clientAccountId: "acct_a",
            clientDisplayName: "Client A",
            portalDisplayName: null,
            portalLoginEmail: "a@example.com",
            portalEnabled: true,
            locationName: null,
            subaccountIdGhl: null,
            primaryNicheKeys: [],
            primaryProductTypes: [],
            hasPortalPassword: true,
            portalSessionEpoch: 2,
          },
        });
      }
      return jsonResponse(401, {
        ok: false,
        error: "Email or password is incorrect. Please try again.",
        code: "INVALID",
      });
    }
    return jsonResponse(404, { ok: false });
  }) as typeof fetch;

  const ok = await authenticatePortalLogin("a@example.com", "acct-a-unique-pass");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.session.clientAccountId, "acct_a");
    assert.equal(ok.session.portalSessionEpoch, 2);
  }
  assert.equal(JSON.stringify(ok).includes("acct-a-unique-pass"), false);
  assert.equal(JSON.stringify(ok).includes("shared-env-pass"), false);

  const envFail = await authenticatePortalLogin("a@example.com", "shared-env-pass");
  assert.equal(envFail.ok, false);
  if (!envFail.ok) {
    assert.equal(envFail.error, "Email or password is incorrect. Please try again.");
  }

  globalThis.fetch = originalFetch;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});

test("authenticatePortalLogin: disabled hashed portal stays inaccessible", async () => {
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  process.env.CLIENT_PORTAL_SESSION_SECRET = "secret";
  process.env.CLIENT_PORTAL_API_KEY = "portal-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://portal-api.test";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse(403, {
      ok: false,
      error: PORTAL_LOGIN_DISABLED,
      code: "PORTAL_DISABLED",
    })) as typeof fetch;

  const result = await authenticatePortalLogin("a@example.com", "acct-a-unique-pass");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_DISABLED);

  globalThis.fetch = originalFetch;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});
