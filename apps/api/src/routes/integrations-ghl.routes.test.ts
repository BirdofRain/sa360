import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminGhlOAuthRoutes, integrationsGhlRoutes } from "./integrations-ghl.js";
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
  const body = res.json() as { ok: boolean; authorizeUrl: string; state: string };
  assert.equal(body.ok, true);
  assert.ok(body.state.length > 0);

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
  const result = await handleGhlMarketplaceWebhook({
    type: "INSTALL",
    locationId: "loc_test_123",
    companyId: "co_1",
    appId: "app_1",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.handled, true);
});

test("GET /integrations/oauth/callback redirects state_invalid without code", async () => {
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
  assert.match(location, /reason=state_invalid/);
  assert.doesNotMatch(location, /client_secret|access_token|refresh_token/i);

  const debug = getGhlOAuthDebugForAdmin();
  if (debug) assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);

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
