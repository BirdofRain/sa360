import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import {
  clientGoogleIntegrationRoutes,
  integrationsGoogleRoutes,
} from "./integrations-google.js";
import { integrationsGhlRoutes } from "./integrations-ghl.js";
import { createGhlOAuthState } from "../lib/ghl-oauth-state.js";

test("C/AG/AJ. Google customer routes require authenticated portal session", async () => {
  const previous = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "test-portal-api-key";
  const app = Fastify();
  await app.register(clientGoogleIntegrationRoutes, { prefix: "/client/v1" });
  try {
    for (const [method, url] of [
      ["GET", "/client/v1/integrations/google/oauth/start"],
      ["GET", "/client/v1/integrations/google/status"],
      ["POST", "/client/v1/integrations/google/disconnect"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { "x-sa360-client-portal-key": "test-portal-api-key" },
      });
      assert.equal(response.statusCode, 401);
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previous;
  }
});

test("D/AH/AK. routes use authenticated tenant and reject browser tenant overrides", async () => {
  const seen: string[] = [];
  const app = Fastify();
  await app.register(clientGoogleIntegrationRoutes, {
    prefix: "/client/v1",
    requirePortalTenant: async () => ({ clientAccountId: "session-tenant" }),
    runtimeDeps: {
      env: {},
      getConnection: (async (clientAccountId: string) => {
        seen.push(clientAccountId);
        return null;
      }) as never,
    },
  });
  try {
    const status = await app.inject({
      method: "GET",
      url: "/client/v1/integrations/google/status",
    });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(seen, ["session-tenant"]);

    const override = await app.inject({
      method: "GET",
      url: "/client/v1/integrations/google/status?clientAccountId=other-tenant",
    });
    assert.equal(override.statusCode, 400);

    const disconnectOverride = await app.inject({
      method: "POST",
      url: "/client/v1/integrations/google/disconnect",
      payload: { clientAccountId: "other-tenant" },
    });
    assert.equal(disconnectOverride.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("T/AQ. Google callback cannot exchange or consume through GHL-compatible state when disabled", async () => {
  let consumed = 0;
  let fetched = 0;
  const app = Fastify();
  await app.register(integrationsGoogleRoutes, {
    prefix: "/integrations",
    runtimeDeps: {
      env: {},
      consumePending: (async () => {
        consumed += 1;
        throw new Error("must not consume");
      }) as never,
      fetchImpl: (async () => {
        fetched += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    },
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/integrations/google/oauth/callback?state=ghl-state&code=ghl-code",
    });
    assert.equal(response.statusCode, 404);
    assert.equal(consumed, 0);
    assert.equal(fetched, 0);
  } finally {
    await app.close();
  }
});

test("AF. callback ignores clientAccountId query as tenant authority", async () => {
  let consumedState = "";
  const app = Fastify();
  await app.register(integrationsGoogleRoutes, {
    prefix: "/integrations",
    runtimeDeps: {
      env: {
        SA360_GOOGLE_OAUTH_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "id",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://api.test/integrations/google/oauth/callback",
        GOOGLE_TOKEN_ENCRYPTION_KEY: "key",
        SA360_PORTAL_PUBLIC_BASE_URL: "https://portal.test",
      },
      consumePending: (async (state: string) => {
        consumedState = state;
        return { ok: false, reason: "not_found" };
      }) as never,
    },
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/integrations/google/oauth/callback?state=opaque&code=code&clientAccountId=attacker",
    });
    assert.equal(response.statusCode, 302);
    assert.equal(consumedState, "opaque");
    assert.equal(response.headers.location?.includes("attacker"), false);
  } finally {
    await app.close();
  }
});

test("AQ-AR. Google and GHL callback routes cannot consume each other's state", async () => {
  const previousAdminKey = process.env.ADMIN_API_KEY;
  const previousCocBase = process.env.ADMIN_COC_BASE_URL;
  process.env.ADMIN_API_KEY = "test-admin-key";
  process.env.ADMIN_COC_BASE_URL = "https://admin.test";
  let googleConsumes = 0;
  let googleFetches = 0;
  const app = Fastify();
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  await app.register(integrationsGoogleRoutes, {
    prefix: "/integrations",
    runtimeDeps: {
      env: {
        SA360_GOOGLE_OAUTH_ENABLED: "true",
        GOOGLE_OAUTH_CLIENT_ID: "google-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://api.test/integrations/google/oauth/callback",
        GOOGLE_TOKEN_ENCRYPTION_KEY: "google-key",
        SA360_PORTAL_PUBLIC_BASE_URL: "https://portal.test",
      },
      consumePending: (async () => {
        googleConsumes += 1;
        return { ok: false, reason: "not_found" };
      }) as never,
      fetchImpl: (async () => {
        googleFetches += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    },
  });
  try {
    const ghlState = createGhlOAuthState({ clientAccountId: "tenant-a" });
    const googleResponse = await app.inject({
      method: "GET",
      url: `/integrations/google/oauth/callback?state=${encodeURIComponent(ghlState)}&code=code`,
    });
    assert.equal(googleResponse.statusCode, 302);
    assert.equal(googleConsumes, 1);
    assert.equal(googleFetches, 0);

    const ghlResponse = await app.inject({
      method: "GET",
      url: "/integrations/oauth/callback?state=google-pending-state&code=code",
    });
    assert.equal(ghlResponse.statusCode, 302);
    assert.equal(googleConsumes, 1);
    assert.equal(googleFetches, 0);
  } finally {
    await app.close();
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    if (previousCocBase === undefined) delete process.env.ADMIN_COC_BASE_URL;
    else process.env.ADMIN_COC_BASE_URL = previousCocBase;
  }
});
