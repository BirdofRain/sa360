import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  adminGhlOAuthRoutes,
  integrationsGhlRoutes,
  processGhlOAuthCallbackRoute,
} from "./integrations-ghl.js";
import {
  getGhlOAuthDebugForAdmin,
  handleGhlMarketplaceWebhook,
} from "../services/ghl-oauth/ghl-connection.service.js";
import { assertNoTokenFieldsInPayload } from "../services/ghl-oauth/ghl-connection.present.js";
import { createGhlOAuthState } from "../lib/ghl-oauth-state.js";
import { clearGhlOAuthDebugForTests } from "../services/ghl-oauth/ghl-oauth-debug.service.js";

const HEADER = "x-sa360-admin-key";
const TEST_REDIRECT_URI =
  "https://sa360-api-staging-coo57.ondigitalocean.app/integrations/oauth/callback";
const TEST_SCOPES = "contacts.readonly contacts.write";

test("GET ghl/oauth/start → 503 when GHL_OAUTH_SCOPES missing", async () => {
  const envKeys = [
    "ADMIN_API_KEY",
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of envKeys) prev[k] = process.env[k];
  delete process.env.GHL_OAUTH_SCOPES;

  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";

  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl/oauth/start",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 503);
  const body = res.json() as { error?: string };
  assert.match(body.error ?? "", /GHL_OAUTH_SCOPES/);
  await app.close();

  for (const k of envKeys) {
    if (prev[k] !== undefined) process.env[k] = prev[k];
    else delete process.env[k];
  }
});

test("GET ghl/oauth/start includes version_id in authorize URL when configured", async () => {
  const envKeys = [
    "ADMIN_API_KEY",
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_OAUTH_SCOPES",
    "GHL_OAUTH_VERSION_ID",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of envKeys) prev[k] = process.env[k];

  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GHL_OAUTH_SCOPES = TEST_SCOPES;
  process.env.GHL_OAUTH_VERSION_ID = "69eb83165d87c883491f3a2c";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";

  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl/oauth/start",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    authorizeUrl: string;
    config: { hasVersionId: boolean; authorizeUrlIncludesVersionId: boolean };
  };
  assert.equal(new URL(body.authorizeUrl).searchParams.get("version_id"), "69eb83165d87c883491f3a2c");
  assert.equal(body.config.hasVersionId, true);
  assert.equal(body.config.authorizeUrlIncludesVersionId, true);

  await app.close();
  for (const k of envKeys) {
    if (prev[k] !== undefined) process.env[k] = prev[k];
    else delete process.env[k];
  }
});

test("GET ghl/oauth/start returns authorize URL with scope and callback", async () => {
  const envKeys = [
    "ADMIN_API_KEY",
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_OAUTH_SCOPES",
    "GHL_OAUTH_AUTHORIZE_BASE_URL",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of envKeys) prev[k] = process.env[k];

  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GHL_OAUTH_SCOPES = TEST_SCOPES;
  process.env.GHL_OAUTH_AUTHORIZE_BASE_URL =
    "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";

  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl/oauth/start",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    ok: boolean;
    authorizeUrl: string;
    state: string;
    config: {
      hasClientId: boolean;
      hasRedirectUri: boolean;
      hasScopes: boolean;
      hasVersionId: boolean;
      authorizeUrlIncludesVersionId: boolean;
    };
  };
  assert.equal(body.ok, true);
  assert.ok(body.state.length > 0);
  assert.equal(body.config.hasClientId, true);
  assert.equal(body.config.hasRedirectUri, true);
  assert.equal(body.config.hasScopes, true);
  assertNoTokenFieldsInPayload(body.config as unknown as Record<string, unknown>);

  const parsed = new URL(body.authorizeUrl);
  assert.equal(parsed.searchParams.get("redirect_uri"), TEST_REDIRECT_URI);
  assert.equal(parsed.searchParams.get("client_id"), "client_id_test");
  assert.equal(parsed.searchParams.get("state"), body.state);
  assert.equal(parsed.searchParams.get("scope"), TEST_SCOPES);
  assert.ok(parsed.pathname.endsWith("/oauth/chooselocation"));

  await app.close();
  for (const k of envKeys) {
    if (prev[k] !== undefined) process.env[k] = prev[k];
    else delete process.env[k];
  }
});

test("GET ghl/oauth/start → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({ method: "GET", url: "/admin/v1/ghl/oauth/start" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl/connections/:id/probe → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/ghl/connections/conn_1/probe",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /integrations/ghl/webhooks accepts INSTALL payload", async () => {
  const result = await handleGhlMarketplaceWebhook(
    {
      type: "INSTALL",
      locationId: "loc_test_123",
      companyId: "co_1",
      appId: "app_1",
    },
    {
      reconcile: async () => ({
        handled: true,
        connectionStatus: "pending_location",
        connectionId: null,
        note: "awaiting_oauth_tokens",
      }),
    }
  );
  assert.equal(result.accepted, true);
  assert.equal(result.handled, true);
});

test("POST /integrations/ghl/webhooks rejects unsigned payloads", async () => {
  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });

  const res = await app.inject({
    method: "POST",
    url: "/integrations/ghl/webhooks",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      type: "INSTALL",
      locationId: "loc_test_123",
      companyId: "co_1",
      appId: "app_1",
    }),
  });

  assert.equal(res.statusCode, 401);
  const body = res.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_signature");
  await app.close();
});

test("POST /integrations/ghl/webhooks accepts signed payloads", async () => {
  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, {
    prefix: "/integrations",
    verifyMarketplaceWebhookSignatureImpl: () => ({ ok: true, scheme: "ghl_ed25519" as const }),
  });

  const res = await app.inject({
    method: "POST",
    url: "/integrations/ghl/webhooks",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      type: "INSTALL",
      locationId: "loc_test_123",
      companyId: "co_1",
      appId: "app_1",
    }),
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; accepted: boolean; handled: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.accepted, true);
  assert.equal(body.handled, true);
  await app.close();
});

test("GET /integrations/oauth/callback returns 400 JSON when ADMIN_COC_BASE_URL missing", async () => {
  const prevCoc = process.env.ADMIN_COC_BASE_URL;
  delete process.env.ADMIN_COC_BASE_URL;
  delete process.env.GHL_OAUTH_COC_REDIRECT_BASE;
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  const res = await app.inject({
    method: "GET",
    url: "/integrations/oauth/callback",
  });
  assert.notEqual(res.statusCode, 404);
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /ADMIN_COC_BASE_URL/);

  await app.close();
  clearGhlOAuthDebugForTests();
  if (prevCoc !== undefined) process.env.ADMIN_COC_BASE_URL = prevCoc;
});

test("GET /integrations/oauth/callback?code=test without state does not 404", async () => {
  const envKeys = [
    "ADMIN_COC_BASE_URL",
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_OAUTH_SCOPES",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of envKeys) prev[k] = process.env[k];
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GHL_OAUTH_SCOPES = TEST_SCOPES;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
  clearGhlOAuthDebugForTests();

  const fetchImpl = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/oauth/token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          locationId: "loc_inject_test",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ location: { name: "Test" } }), { status: 200 });
  };

  try {
    const outcome = await processGhlOAuthCallbackRoute(
      { code: "test" },
      "req-inject-route",
      {
        fetchImpl: fetchImpl as typeof fetch,
        persistTokens: async () => ({ id: "conn_inject" }),
      }
    );
    assert.equal(outcome.kind, "redirect");
    assert.match(outcome.redirectUrl, /connected_unlinked/);
    assert.match(outcome.redirectUrl, /loc_inject_test/);

    const app = Fastify({ logger: false });
    await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
    const res = await app.inject({
      method: "GET",
      url: "/integrations/oauth/callback",
    });
    assert.notEqual(res.statusCode, 404);
    await app.close();
  } finally {
    clearGhlOAuthDebugForTests();
    for (const k of envKeys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
  }
});

test("GET /integrations/oauth/callback with no params does not 404", async () => {
  const prevCoc = process.env.ADMIN_COC_BASE_URL;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  const res = await app.inject({
    method: "GET",
    url: "/integrations/oauth/callback",
  });
  assert.notEqual(res.statusCode, 404);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location as string, /reason=missing_code_or_state/);

  await app.close();
  clearGhlOAuthDebugForTests();
  if (prevCoc !== undefined) process.env.ADMIN_COC_BASE_URL = prevCoc;
  else delete process.env.ADMIN_COC_BASE_URL;
});

test("GET /integrations/oauth/callback redirects missing_code_or_state without code", async () => {
  const prevCoc = process.env.ADMIN_COC_BASE_URL;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  const res = await app.inject({
    method: "GET",
    url: "/integrations/oauth/callback?state=abc",
  });
  assert.equal(res.statusCode, 302);
  const location = res.headers.location as string;
  assert.match(location, /ghl_oauth=error/);
  assert.match(location, /reason=missing_code_or_state/);
  assert.doesNotMatch(location, /client_secret|access_token|refresh_token/i);

  const debug = getGhlOAuthDebugForAdmin();
  if (debug) assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);

  await app.close();
  clearGhlOAuthDebugForTests();
  if (prevCoc !== undefined) process.env.ADMIN_COC_BASE_URL = prevCoc;
  else delete process.env.ADMIN_COC_BASE_URL;
});

test("callback with code but no state stores unlinked connection", async () => {
  const envKeys = [
    "ADMIN_COC_BASE_URL",
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_OAUTH_SCOPES",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of envKeys) prev[k] = process.env[k];
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GHL_OAUTH_SCOPES = TEST_SCOPES;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
  clearGhlOAuthDebugForTests();

  const fetchImpl = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/oauth/token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expires_in: 3600,
          scope: "contacts.readonly",
          locationId: "loc_unlinked_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ location: { name: "Unlinked Loc" } }), { status: 200 });
  };

  try {
    const outcome = await processGhlOAuthCallbackRoute(
      { code: "marketplace-code" },
      "req-unlinked-route",
      {
        fetchImpl: fetchImpl as typeof fetch,
        persistTokens: async () => undefined,
      }
    );
    assert.equal(outcome.kind, "redirect");
    if (outcome.kind !== "redirect") return;
    assert.match(outcome.redirectUrl, /ghl_oauth=connected_unlinked/);
    assert.match(outcome.redirectUrl, /locationId=loc_unlinked_1/);
    assert.doesNotMatch(outcome.redirectUrl, /access-token-value|refresh-token-value/i);

    const debug = getGhlOAuthDebugForAdmin();
    assert.equal(debug?.outcome, "connected_unlinked");
    if (debug) assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);
  } finally {
    clearGhlOAuthDebugForTests();
    for (const k of envKeys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
  }
});

test("GET /integrations/oauth/callback redirects state_invalid with bad state", async () => {
  const prevCoc = process.env.ADMIN_COC_BASE_URL;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  const res = await app.inject({
    method: "GET",
    url: "/integrations/oauth/callback?code=abc&state=not-valid-state",
  });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location as string, /reason=state_invalid/);

  await app.close();
  clearGhlOAuthDebugForTests();
  if (prevCoc !== undefined) process.env.ADMIN_COC_BASE_URL = prevCoc;
  else delete process.env.ADMIN_COC_BASE_URL;
});

test("GET /integrations/oauth/callback redirects token_exchange_failed", async () => {
  const envKeys = [
    "ADMIN_COC_BASE_URL",
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of envKeys) prev[k] = process.env[k];
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
  clearGhlOAuthDebugForTests();

  const state = createGhlOAuthState({ clientAccountId: "client_1" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const app = Fastify({ logger: false });
    await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
    const res = await app.inject({
      method: "GET",
      url: `/integrations/oauth/callback?code=bad&state=${encodeURIComponent(state)}`,
    });
    assert.equal(res.statusCode, 302);
    const location = res.headers.location as string;
    assert.match(location, /reason=token_exchange_failed/);
    assert.doesNotMatch(location, /client_secret_test|invalid_grant.*access_token/i);

    const debug = getGhlOAuthDebugForAdmin();
    assert.ok(debug);
    assert.equal(debug?.outcome, "token_exchange_failed");
    if (debug) assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);

    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
    clearGhlOAuthDebugForTests();
    for (const k of envKeys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
  }
});

test("GET ghl/oauth/debug returns latest safe snapshot", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl/oauth/debug",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; latest: unknown };
  assert.equal(body.ok, true);
  assert.equal(body.latest, null);
  await app.close();

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
