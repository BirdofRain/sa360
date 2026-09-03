import test from "node:test";
import assert from "node:assert/strict";
import { postPortalPasswordResetRequest } from "../client-portal-api/portal-context.ts";
import { portalBffHasBrowserTenantOverride } from "./portal-bff-auth.ts";
import {
  authenticatePortalLogin,
  isClientPortalLegacyPasswordConfigured,
  isClientPortalLoginConfigured,
  isClientPortalSessionConfigured,
  PORTAL_LOGIN_INVALID_CREDENTIALS,
  PORTAL_LOGIN_SETUP_ERROR,
  readTrustedPortalSession,
} from "./portal-auth.ts";
import {
  PORTAL_LOGIN_SETUP_BANNER,
  resolvePortalLoginPageView,
} from "./portal-login-flow.ts";
import {
  createPortalSessionToken,
  parsePortalSessionToken,
} from "./portal-session.ts";
import { isClientPortalAccessGateRequired } from "./access-gate.ts";
import {
  PORTAL_FORGOT_PASSWORD_LINK,
  PORTAL_FORGOT_PASSWORD_PATH,
} from "./portal-password-reset-flow.ts";

const MODERN_ENV = {
  CLIENT_PORTAL_SESSION_SECRET: "retire-session-secret",
  CLIENT_PORTAL_API_KEY: "retire-portal-key",
  NEXT_PUBLIC_SA360_API_BASE_URL: "http://portal-api.test",
} as const;

const TENANT_A = {
  email: "tenant.a.retire@example.test",
  password: "tenant-a-individual-pass",
  clientAccountId: "acct_retire_a",
  epoch: 4,
} as const;

const TENANT_B = {
  email: "tenant.b.retire@example.test",
  clientAccountId: "acct_retire_b",
  epoch: 0,
} as const;

const SHARED_PASSWORD = "shared-env-retire-pass";

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of keys) prev[key] = process.env[key];
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function applyModernLoginEnv(sharedPassword?: string): Record<string, string | undefined> {
  const prev = snapshotEnv([
    "CLIENT_PORTAL_SESSION_SECRET",
    "CLIENT_PORTAL_API_KEY",
    "NEXT_PUBLIC_SA360_API_BASE_URL",
    "NEXT_PUBLIC_API_BASE_URL",
    "CLIENT_PORTAL_LOGIN_PASSWORD",
    "CLIENT_PORTAL_LOGIN_EMAIL",
    "CLIENT_PORTAL_CLIENT_ACCOUNT_ID",
    "CLIENT_PORTAL_ACCESS_CODE",
  ]);
  process.env.CLIENT_PORTAL_SESSION_SECRET = MODERN_ENV.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_API_KEY = MODERN_ENV.CLIENT_PORTAL_API_KEY;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = MODERN_ENV.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  if (sharedPassword === undefined) delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  else process.env.CLIENT_PORTAL_LOGIN_PASSWORD = sharedPassword;
  return prev;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function customerLoginResponse(opts: {
  email: string;
  clientAccountId: string;
  epoch: number;
  portalEnabled?: boolean;
}): unknown {
  return {
    ok: true,
    passwordCheck: "customer",
    portalSessionEpoch: opts.epoch,
    context: {
      clientAccountId: opts.clientAccountId,
      clientDisplayName: opts.clientAccountId,
      portalDisplayName: null,
      portalLoginEmail: opts.email,
      portalEnabled: opts.portalEnabled ?? true,
      locationName: null,
      subaccountIdGhl: null,
      primaryNicheKeys: [],
      primaryProductTypes: [],
      hasPortalPassword: true,
      portalSessionEpoch: opts.epoch,
    },
  };
}

function envFallbackLoginResponse(opts: {
  email: string;
  clientAccountId: string;
  epoch?: number;
  portalEnabled?: boolean;
}): unknown {
  return {
    ok: true,
    passwordCheck: "env_fallback",
    portalSessionEpoch: opts.epoch ?? 0,
    context: {
      clientAccountId: opts.clientAccountId,
      clientDisplayName: opts.clientAccountId,
      portalDisplayName: null,
      portalLoginEmail: opts.email,
      portalEnabled: opts.portalEnabled ?? true,
      locationName: null,
      subaccountIdGhl: null,
      primaryNicheKeys: [],
      primaryProductTypes: [],
      hasPortalPassword: false,
      portalSessionEpoch: opts.epoch ?? 0,
    },
  };
}

function installTwoTenantLoginFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/client/v1/portal-login") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        loginEmail?: string;
        password?: string;
      };
      if (body.loginEmail === TENANT_A.email && body.password === TENANT_A.password) {
        return jsonResponse(200, customerLoginResponse(TENANT_A));
      }
      if (body.loginEmail === TENANT_A.email) {
        return jsonResponse(401, {
          ok: false,
          error: PORTAL_LOGIN_INVALID_CREDENTIALS,
          code: "INVALID",
        });
      }
      if (body.loginEmail === TENANT_B.email) {
        return jsonResponse(200, envFallbackLoginResponse(TENANT_B));
      }
      return jsonResponse(401, {
        ok: false,
        error: PORTAL_LOGIN_INVALID_CREDENTIALS,
        code: "INVALID",
      });
    }
    if (url.includes("/client/v1/portal-session-state") && method === "GET") {
      const parsedUrl = new URL(url);
      const clientAccountId = parsedUrl.searchParams.get("clientAccountId");
      if (clientAccountId === TENANT_A.clientAccountId) {
        return jsonResponse(200, {
          ok: true,
          clientAccountId: TENANT_A.clientAccountId,
          portalSessionEpoch: TENANT_A.epoch,
          portalEnabled: true,
        });
      }
      if (clientAccountId === TENANT_B.clientAccountId) {
        return jsonResponse(200, {
          ok: true,
          clientAccountId: TENANT_B.clientAccountId,
          portalSessionEpoch: TENANT_B.epoch,
          portalEnabled: true,
        });
      }
      return jsonResponse(404, { ok: false });
    }
    return jsonResponse(404, { ok: false });
  }) as typeof fetch;
}

test("modern login readiness does not depend on CLIENT_PORTAL_LOGIN_PASSWORD", () => {
  const prev = applyModernLoginEnv();
  delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  assert.equal(isClientPortalSessionConfigured(), true);
  assert.equal(isClientPortalLegacyPasswordConfigured(), false);
  assert.equal(isClientPortalLoginConfigured(), true);
  restoreEnv(prev);
});

test("login page renders form when session+API are set and shared password is unset", () => {
  const prev = applyModernLoginEnv();
  assert.equal(isClientPortalLoginConfigured(), true);
  assert.equal(resolvePortalLoginPageView(), "form");
  assert.equal(resolvePortalLoginPageView(false), "not_configured");
  assert.ok(PORTAL_LOGIN_SETUP_BANNER.includes("Sign-in is not configured yet"));
  restoreEnv(prev);
});

test("converted tenant A authenticates with customer password when shared password is unset", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const result = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.session.clientAccountId, TENANT_A.clientAccountId);
    assert.equal(result.session.portalLoginEmail, TENANT_A.email);
    assert.equal(result.session.portalSessionEpoch, TENANT_A.epoch);
    const token = createPortalSessionToken(result.session);
    assert.ok(token);
    const parsed = parsePortalSessionToken(token);
    assert.ok(parsed);
    assert.equal(parsed.clientAccountId, TENANT_A.clientAccountId);
    assert.equal(parsed.portalSessionEpoch, TENANT_A.epoch);
    const trusted = await readTrustedPortalSession(token);
    assert.ok(trusted);
    assert.equal(trusted.clientAccountId, TENANT_A.clientAccountId);
  }
  assert.equal(JSON.stringify(result).includes(TENANT_A.password), false);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("converted tenant A rejects the wrong password when shared password is unset", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const result = await authenticatePortalLogin(TENANT_A.email, "wrong-password");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("null-hash tenant B fails when shared password is unset", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const result = await authenticatePortalLogin(TENANT_B.email, "any-password");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("null-hash tenant B still uses optional env fallback when shared password is set", async () => {
  const prev = applyModernLoginEnv(SHARED_PASSWORD);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const result = await authenticatePortalLogin(TENANT_B.email, SHARED_PASSWORD);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.session.clientAccountId, TENANT_B.clientAccountId);
    assert.equal(result.session.portalSessionEpoch, TENANT_B.epoch);
  }

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("shared password cannot authenticate a converted hash-bound account", async () => {
  const prev = applyModernLoginEnv(SHARED_PASSWORD);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const result = await authenticatePortalLogin(TENANT_A.email, SHARED_PASSWORD);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);

  const customerStillWorks = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(customerStillWorks.ok, true);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("session secret missing fails closed even when API and shared password are set", async () => {
  const prev = applyModernLoginEnv(SHARED_PASSWORD);
  delete process.env.CLIENT_PORTAL_SESSION_SECRET;
  assert.equal(isClientPortalSessionConfigured(), false);
  assert.equal(isClientPortalLoginConfigured(), false);
  assert.equal(resolvePortalLoginPageView(), "not_configured");
  const result = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_SETUP_ERROR);
  restoreEnv(prev);
});

test("portal API config missing fails closed even when session secret is set", async () => {
  const prev = applyModernLoginEnv(SHARED_PASSWORD);
  delete process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  assert.equal(isClientPortalLoginConfigured(), false);
  assert.equal(resolvePortalLoginPageView(), "not_configured");
  const result = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_SETUP_ERROR);
  restoreEnv(prev);
});

test("API outage plus missing shared password cannot authenticate anyone", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("portal-login unreachable");
  }) as typeof fetch;

  const result = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("forgot password still works when shared password is absent", async () => {
  const prev = applyModernLoginEnv();
  assert.equal(resolvePortalLoginPageView(), "form");
  assert.equal(PORTAL_FORGOT_PASSWORD_PATH, "/portal/forgot-password");
  assert.equal(PORTAL_FORGOT_PASSWORD_LINK, "Forgot password?");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse(200, { ok: true, message: "generic" })) as typeof fetch;
  const result = await postPortalPasswordResetRequest(TENANT_A.email, "203.0.113.10");
  assert.equal(result.ok, true);
  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("trusted session reading and revocation stay independent of shared password", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  const token = createPortalSessionToken({
    clientAccountId: TENANT_A.clientAccountId,
    clientDisplayName: "Tenant A",
    portalDisplayName: null,
    portalLoginEmail: TENANT_A.email,
    portalSessionEpoch: TENANT_A.epoch,
  });
  assert.ok(token);

  globalThis.fetch = installTwoTenantLoginFetch();
  const trusted = await readTrustedPortalSession(token);
  assert.ok(trusted);
  assert.equal(trusted.clientAccountId, TENANT_A.clientAccountId);

  globalThis.fetch = (async () =>
    jsonResponse(200, {
      ok: true,
      clientAccountId: TENANT_A.clientAccountId,
      portalSessionEpoch: TENANT_A.epoch + 1,
      portalEnabled: true,
    })) as typeof fetch;
  assert.equal(await readTrustedPortalSession(token), null);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("tenant isolation remains unchanged without a shared password", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const asB = await authenticatePortalLogin(TENANT_B.email, TENANT_A.password);
  assert.equal(asB.ok, false);

  const asA = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(asA.ok, true);
  if (asA.ok) {
    assert.equal(asA.session.clientAccountId, TENANT_A.clientAccountId);
    assert.notEqual(asA.session.clientAccountId, TENANT_B.clientAccountId);
  }

  const hijack = new URLSearchParams({
    range: "7d",
    clientAccountId: TENANT_B.clientAccountId,
  });
  assert.equal(portalBffHasBrowserTenantOverride(hijack), true);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});

test("access gate is not used when modern login is ready without a shared password", () => {
  const prev = applyModernLoginEnv();
  process.env.CLIENT_PORTAL_ACCESS_CODE = "leftover-invite";
  assert.equal(isClientPortalLoginConfigured(), true);
  assert.equal(isClientPortalAccessGateRequired(), false);
  restoreEnv(prev);
});

test("connected matrix: converted succeeds and null-hash fails until shared password is injected", async () => {
  const prev = applyModernLoginEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = installTwoTenantLoginFetch();

  const converted = await authenticatePortalLogin(TENANT_A.email, TENANT_A.password);
  assert.equal(converted.ok, true);
  if (converted.ok) {
    assert.equal(converted.session.clientAccountId, TENANT_A.clientAccountId);
    const token = createPortalSessionToken(converted.session);
    assert.ok(token);
    assert.equal(parsePortalSessionToken(token)?.clientAccountId, TENANT_A.clientAccountId);
  }

  const nullHashWithoutShared = await authenticatePortalLogin(TENANT_B.email, SHARED_PASSWORD);
  assert.equal(nullHashWithoutShared.ok, false);

  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = SHARED_PASSWORD;
  assert.equal(isClientPortalLegacyPasswordConfigured(), true);
  assert.equal(isClientPortalLoginConfigured(), true);

  const nullHashWithShared = await authenticatePortalLogin(TENANT_B.email, SHARED_PASSWORD);
  assert.equal(nullHashWithShared.ok, true);
  if (nullHashWithShared.ok) {
    assert.equal(nullHashWithShared.session.clientAccountId, TENANT_B.clientAccountId);
  }

  const sharedAgainstConverted = await authenticatePortalLogin(TENANT_A.email, SHARED_PASSWORD);
  assert.equal(sharedAgainstConverted.ok, false);

  globalThis.fetch = originalFetch;
  restoreEnv(prev);
});
