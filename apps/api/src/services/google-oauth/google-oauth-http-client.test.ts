import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
} from "../../lib/google-oauth-env.js";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleIdentity,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "./google-oauth-http-client.js";

const config = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://api.test/integrations/google/oauth/callback",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("U. token exchange uses fixed endpoint, form encoding, PKCE, and no retries", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(String(input), GOOGLE_OAUTH_TOKEN_URL);
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers && (init.headers as Record<string, string>)["Content-Type"], "application/x-www-form-urlencoded");
    const form = init?.body as URLSearchParams;
    assert.equal(form.get("client_id"), config.clientId);
    assert.equal(form.get("client_secret"), config.clientSecret);
    assert.equal(form.get("code"), "authorization-code");
    assert.equal(form.get("code_verifier"), "pkce-verifier");
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("redirect_uri"), config.redirectUri);
    assert.ok(init?.signal);
    return jsonResponse({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "openid email",
      token_type: "Bearer",
    });
  };
  const result = await exchangeGoogleAuthorizationCode(
    { code: "authorization-code", codeVerifier: "pkce-verifier", config },
    fetchImpl
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("V-Y. token exchange classifies 429, 5xx, network, and malformed responses", async () => {
  const cases: Array<[typeof fetch, string]> = [
    [async () => jsonResponse({ error: "slow_down" }, 429), "rate_limited"],
    [async () => jsonResponse({ error: "server_error" }, 503), "server_error"],
    [async () => { throw new Error("timeout"); }, "network_error"],
    [async () => new Response("not-json", { status: 200 }), "malformed_response"],
  ];
  for (const [fetchImpl, expected] of cases) {
    const result = await exchangeGoogleAuthorizationCode(
      { code: "code", codeVerifier: "verifier", config },
      fetchImpl
    );
    assert.deepEqual(result, { ok: false, reason: expected });
  }
});

test("terminal invalid_grant and missing first refresh token fail safely", async () => {
  const invalidGrant = await exchangeGoogleAuthorizationCode(
    { code: "code", codeVerifier: "verifier", config },
    async () => jsonResponse({ error: "invalid_grant" }, 400)
  );
  assert.deepEqual(invalidGrant, { ok: false, reason: "invalid_grant" });

  const noRefresh = await exchangeGoogleAuthorizationCode(
    { code: "code", codeVerifier: "verifier", config },
    async () => jsonResponse({ access_token: "access", expires_in: 3600 })
  );
  assert.deepEqual(noRefresh, { ok: false, reason: "malformed_response" });
});

test("AA-AB. OIDC userinfo supplies verified identity and requires stable sub", async () => {
  const ok = await fetchGoogleIdentity("access", async (input, init) => {
    assert.equal(String(input), GOOGLE_OAUTH_USERINFO_URL);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer access");
    return jsonResponse({ sub: "google-sub", email: "user@example.com", name: "User" });
  });
  assert.deepEqual(ok, {
    ok: true,
    identity: {
      googleUserId: "google-sub",
      email: "user@example.com",
      displayName: "User",
    },
  });
  const missingSub = await fetchGoogleIdentity("access", async () =>
    jsonResponse({ email: "user@example.com" })
  );
  assert.deepEqual(missingSub, { ok: false, reason: "malformed_response" });
});

test("AL-AN. revoke classifies success, invalid token, and transient failures", async () => {
  for (const [status, expected] of [
    [200, { ok: true, result: "revoked" }],
    [400, { ok: true, result: "already_invalid" }],
    [429, { ok: false, reason: "transient" }],
    [503, { ok: false, reason: "transient" }],
  ] as const) {
    const result = await revokeGoogleToken("refresh", async (input, init) => {
      assert.equal(String(input), GOOGLE_OAUTH_REVOKE_URL);
      assert.equal((init?.body as URLSearchParams).get("token"), "refresh");
      return new Response("", { status });
    });
    assert.deepEqual(result, expected);
  }
  assert.deepEqual(
    await revokeGoogleToken("refresh", async () => {
      throw new Error("network");
    }),
    { ok: false, reason: "transient" }
  );
});

test("K-O. refresh token grant uses the fixed endpoint and optional replacement refresh token", async () => {
  let calls = 0;
  const result = await refreshGoogleAccessToken(
    { refreshToken: "stored-refresh", config },
    async (input, init) => {
      calls += 1;
      assert.equal(String(input), GOOGLE_OAUTH_TOKEN_URL);
      const form = init?.body as URLSearchParams;
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("refresh_token"), "stored-refresh");
      assert.equal(form.get("client_id"), config.clientId);
      assert.equal(form.get("client_secret"), config.clientSecret);
      assert.equal(form.get("code"), null);
      return jsonResponse({
        access_token: "new-access",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.token.accessToken, "new-access");
    assert.equal(result.token.refreshToken, null);
  }
});

test("O. refresh classifies invalid_grant, 401/403, 429, 5xx, timeout, and malformed JSON", async () => {
  const cases: Array<[typeof fetch, string]> = [
    [async () => jsonResponse({ error: "invalid_grant" }, 400), "invalid_grant"],
    [async () => jsonResponse({ error: "unauthorized" }, 401), "terminal_credential"],
    [async () => jsonResponse({ error: "forbidden" }, 403), "terminal_credential"],
    [async () => jsonResponse({ error: "slow_down" }, 429), "rate_limited"],
    [async () => jsonResponse({ error: "server_error" }, 503), "server_error"],
    [async () => { throw new Error("timeout"); }, "network_error"],
    [async () => new Response("not-json", { status: 200 }), "malformed_response"],
  ];
  for (const [fetchImpl, expected] of cases) {
    const result = await refreshGoogleAccessToken(
      { refreshToken: "stored-refresh", config },
      fetchImpl
    );
    assert.deepEqual(result, { ok: false, reason: expected });
  }
});
