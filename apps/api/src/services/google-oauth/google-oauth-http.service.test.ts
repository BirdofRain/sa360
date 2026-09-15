import assert from "node:assert/strict";
import test from "node:test";

import { encryptGoogleToken } from "../../lib/google-token-encryption.js";
import {
  disconnectGoogleOAuth,
  getGoogleOAuthStatus,
  handleGoogleOAuthCallback,
  startGoogleOAuth,
  type GoogleOAuthRuntimeDeps,
} from "./google-oauth-http.service.js";

const KEY = "phase-1b-google-test-key";
const enabledEnv = {
  SA360_GOOGLE_OAUTH_ENABLED: "true",
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://api.test/integrations/google/oauth/callback",
  GOOGLE_TOKEN_ENCRYPTION_KEY: KEY,
  SA360_PORTAL_PUBLIC_BASE_URL: "https://portal.test",
} as NodeJS.ProcessEnv;

const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

function pending() {
  return {
    id: "pending-1",
    clientAccountId: "tenant-a",
    returnTo: "/portal/account",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function connection(
  status: "connected" | "reconnect_required" | "disconnected" | "error" = "connected"
) {
  return {
    id: "connection-1",
    clientAccountId: "tenant-a",
    googleUserId: "google-sub",
    googleEmail: "user@example.com",
    googleDisplayName: "User",
    status,
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    scopes: ["openid"],
    tokenType: "Bearer",
    tokenVersion: 1,
    connectedAt: new Date().toISOString(),
    lastRefreshedAt: new Date().toISOString(),
    reconnectRequiredAt: null,
    disconnectedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("B. flag-off start creates no pending auth and requires no Google config", async () => {
  let calls = 0;
  const result = await startGoogleOAuth("tenant-a", undefined, {
    env: {},
    createPending: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  assert.deepEqual(result, { ok: false, statusCode: 404, code: "oauth_disabled" });
  assert.equal(calls, 0);
});

test("D-K. start binds supplied authenticated tenant and emits safe authorization URL", async () => {
  let input: Record<string, unknown> | undefined;
  const result = await startGoogleOAuth("session-tenant", "/portal/orders", {
    env: enabledEnv,
    generateVerifier: () => verifier,
    createPending: (async (value: Record<string, unknown>) => {
      input = value;
      return { ok: true, state: "opaque-state", pending: pending() };
    }) as never,
  });
  assert.equal(result.ok, true);
  assert.equal(input?.clientAccountId, "session-tenant");
  assert.equal(input?.returnTo, "/portal/orders");
  if (!result.ok) return;
  const url = new URL(result.authorizeUrl);
  assert.equal(url.searchParams.get("state"), "opaque-state");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(result.authorizeUrl.includes("test-client-secret"), false);
});

test("F. malicious returnTo fails without authorization redirect", async () => {
  const result = await startGoogleOAuth("tenant-a", "https://evil.example", {
    env: enabledEnv,
    generateVerifier: () => verifier,
    createPending: (async () => ({ ok: false, reason: "invalid_return_to" })) as never,
  });
  assert.deepEqual(result, { ok: false, statusCode: 400, code: "invalid_return_to" });
});

test("N-O/U/AA/AF. callback consumes once, exchanges once, verifies userinfo, and redirects safely", async () => {
  let consumes = 0;
  let exchanges = 0;
  let saved: Record<string, unknown> | undefined;
  const deps: GoogleOAuthRuntimeDeps = {
    env: enabledEnv,
    consumePending: (async () => {
      consumes += 1;
      if (consumes > 1) return { ok: false, reason: "already_consumed" };
      return { ok: true, pending: pending(), pkceVerifier: verifier, returnTo: "/portal/account" };
    }) as never,
    fetchImpl: (async (input: string | URL | Request) => {
      if (String(input).endsWith("/token")) {
        exchanges += 1;
        return new Response(
          JSON.stringify({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            expires_in: 3600,
            scope: "openid email profile https://www.googleapis.com/auth/spreadsheets",
            token_type: "Bearer",
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ sub: "google-sub", email: "user@example.com", name: "User" }),
        { status: 200 }
      );
    }) as typeof fetch,
    upsertConnection: (async (value: Record<string, unknown>) => {
      saved = value;
      return { ok: true, connection: connection() };
    }) as never,
  };
  const first = await handleGoogleOAuthCallback(
    { state: "raw-state", code: "authorization-code" },
    deps
  );
  assert.equal(first.kind, "redirect");
  if (first.kind === "redirect") {
    assert.equal(first.url, "https://portal.test/portal/account?google=connected");
    assert.equal(/raw-state|authorization-code|access-secret|refresh-secret/.test(first.url), false);
  }
  assert.equal(saved?.clientAccountId, "tenant-a");
  assert.equal(saved?.googleUserId, "google-sub");

  const replay = await handleGoogleOAuthCallback(
    { state: "raw-state", code: "authorization-code" },
    deps
  );
  assert.equal(replay.kind, "redirect");
  assert.equal(exchanges, 1);
});

test("P-T. callback failures and authorization cancellation never exchange", async () => {
  for (const query of [
    {},
    { state: "invalid" },
    { state: "valid" },
    { state: "valid", error: "access_denied" },
  ]) {
    let fetches = 0;
    const result = await handleGoogleOAuthCallback(query, {
      env: enabledEnv,
      consumePending: (async (state: string) =>
        state === "valid"
          ? { ok: true, pending: pending(), pkceVerifier: verifier, returnTo: "/portal/account" }
          : { ok: false, reason: "not_found" }) as never,
      fetchImpl: (async () => {
        fetches += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    assert.equal(result.kind, "redirect");
    assert.equal(fetches, 0);
  }
  let disabledFetches = 0;
  const disabled = await handleGoogleOAuthCallback(
    { state: "state", code: "code" },
    {
      env: {},
      fetchImpl: (async () => {
        disabledFetches += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    }
  );
  assert.deepEqual(disabled, { kind: "error", statusCode: 404, code: "oauth_disabled" });
  assert.equal(disabledFetches, 0);
});

test("AC. identity collision maps to non-sensitive account_in_use redirect", async () => {
  const result = await handleGoogleOAuthCallback(
    { state: "state", code: "code" },
    {
      env: enabledEnv,
      consumePending: (async () => ({
        ok: true,
        pending: pending(),
        pkceVerifier: verifier,
        returnTo: "/portal/account",
      })) as never,
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/token")
          ? new Response(
              JSON.stringify({
                access_token: "access",
                refresh_token: "refresh",
                expires_in: 3600,
              }),
              { status: 200 }
            )
          : new Response(JSON.stringify({ sub: "google-sub" }), { status: 200 })) as typeof fetch,
      upsertConnection: (async () => ({
        ok: false,
        reason: "google_identity_owned_by_other_tenant",
      })) as never,
    }
  );
  assert.deepEqual(result, {
    kind: "redirect",
    url: "https://portal.test/portal/account?google=account_in_use",
  });
});

test("AH-AI. status is tenant-bound and presenter-safe", async () => {
  let tenant = "";
  const status = await getGoogleOAuthStatus("tenant-a", {
    env: {},
    getConnection: (async (id: string) => {
      tenant = id;
      return connection();
    }) as never,
  });
  assert.equal(tenant, "tenant-a");
  assert.equal(status.connected, true);
  assert.equal(status.oauthAvailable, false);
  assert.deepEqual(
    Object.keys(status).sort(),
    [
      "connected",
      "connectedAt",
      "googleDisplayName",
      "googleEmail",
      "oauthAvailable",
      "reconnectRequiredAt",
      "status",
    ].sort()
  );
});

test("AL/AO. disconnect revokes refresh token and wipes locally even with flag off", async () => {
  const previous = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY;
  try {
    let revokedToken = "";
    let disconnected = 0;
    let current = connection();
    const result = await disconnectGoogleOAuth("tenant-a", {
      env: { GOOGLE_TOKEN_ENCRYPTION_KEY: KEY },
      getConnection: (async () => current) as never,
      getSecrets: (async () => ({
        id: "connection-1",
        clientAccountId: "tenant-a",
        status: "connected",
        tokenVersion: 7,
        accessTokenEncrypted: encryptGoogleToken("access-token"),
        refreshTokenEncrypted: encryptGoogleToken("refresh-token"),
        tokenExpiresAt: new Date(),
        tokenType: "Bearer",
        scopes: [],
      })) as never,
      fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
        revokedToken = (init?.body as URLSearchParams).get("token") ?? "";
        return new Response("", { status: 200 });
      }) as typeof fetch,
      disconnectConnection: (async () => {
        disconnected += 1;
        current = connection("disconnected");
        return { connection: current };
      }) as never,
    });
    assert.equal(result.ok, true);
    assert.equal(revokedToken, "refresh-token");
    assert.equal(disconnected, 1);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("AN. transient revoke failure preserves ciphertext for retry", async () => {
  const previous = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY;
  try {
    let disconnected = 0;
    const result = await disconnectGoogleOAuth("tenant-a", {
      env: { GOOGLE_TOKEN_ENCRYPTION_KEY: KEY },
      getConnection: (async () => connection()) as never,
      getSecrets: (async () => ({
        id: "connection-1",
        clientAccountId: "tenant-a",
        status: "connected",
        tokenVersion: 7,
        accessTokenEncrypted: encryptGoogleToken("access-token"),
        refreshTokenEncrypted: encryptGoogleToken("refresh-token"),
        tokenExpiresAt: new Date(),
        tokenType: "Bearer",
        scopes: [],
      })) as never,
      fetchImpl: (async () => new Response("", { status: 503 })) as typeof fetch,
      disconnectConnection: (async () => {
        disconnected += 1;
        throw new Error("must not wipe");
      }) as never,
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 503,
      code: "revoke_retryable",
    });
    assert.equal(disconnected, 0);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previous;
  }
});
