import test from "node:test";
import assert from "node:assert/strict";
import { createGhlOAuthState } from "../../lib/ghl-oauth-state.js";
import { assertNoTokenFieldsInPayload } from "./ghl-connection.present.js";
import { clearGhlOAuthDebugForTests, getLatestGhlOAuthDebug } from "./ghl-oauth-debug.service.js";
import { handleGhlOAuthCallback } from "./ghl-connection.service.js";
import { assertNoSecretsInString } from "./ghl-oauth-callback-log.js";

const TEST_KEY = "test-encryption-key-for-unit-tests-only";

function fetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function withOAuthCallbackEnv(run: () => void | Promise<void>): Promise<void> {
  const keys = [
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_TOKEN_ENCRYPTION_KEY",
    "ADMIN_COC_BASE_URL",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI =
    "https://sa360-api-staging-coo57.ondigitalocean.app/integrations/oauth/callback";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";

  return Promise.resolve(run()).finally(() => {
    clearGhlOAuthDebugForTests();
    for (const k of keys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
  });
}

test("handleGhlOAuthCallback redirects state_invalid for bad state", () =>
  withOAuthCallbackEnv(async () => {
    const result = await handleGhlOAuthCallback({
      code: "auth-code",
      state: "not-valid-state",
      requestId: "req-state-invalid",
    });
    assert.match(result.redirectUrl, /ghl_oauth=error/);
    assert.match(result.redirectUrl, /reason=state_invalid/);
    assert.doesNotMatch(result.redirectUrl, /client_secret|access_token|refresh_token/i);

    const debug = getLatestGhlOAuthDebug();
    assert.ok(debug);
    assert.equal(debug?.stateValid, false);
    assert.equal(debug?.outcome, "state_invalid");
    assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);
    assertNoSecretsInString(JSON.stringify(debug));
  }));

test("handleGhlOAuthCallback redirects token_exchange_failed without exposing secrets", () =>
  withOAuthCallbackEnv(async () => {
    const state = createGhlOAuthState({ clientAccountId: "client_1" });
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          access_token: "must-not-leak",
          refresh_token: "must-not-leak",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );

    const result = await handleGhlOAuthCallback(
      { code: "bad-code", state, requestId: "req-token-fail" },
      { fetchImpl: fetchImpl as typeof fetch }
    );

    assert.match(result.redirectUrl, /reason=token_exchange_failed/);
    assert.doesNotMatch(result.redirectUrl, /must-not-leak|access_token|refresh_token/i);

    const debug = getLatestGhlOAuthDebug();
    assert.ok(debug);
    assert.equal(debug?.tokenExchangeStatusCode, 400);
    assert.equal(debug?.outcome, "token_exchange_failed");
    assert.ok(debug?.tokenExchangeError);
    assertNoSecretsInString(debug?.tokenExchangeError ?? "");
    assertNoSecretsInString(JSON.stringify(debug));
  }));

test("handleGhlOAuthCallback redirects storage_failed when persist throws", () =>
  withOAuthCallbackEnv(async () => {
    const state = createGhlOAuthState({ clientAccountId: "client_1" });
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expires_in: 3600,
          scope: "contacts.readonly",
          locationId: "loc_storage_fail",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const result = await handleGhlOAuthCallback(
      { code: "good-code", state, requestId: "req-storage-fail" },
      {
        fetchImpl: async (input, init) => {
          const url = fetchInputUrl(input);
          if (url.includes("/oauth/token")) return fetchImpl();
          return new Response(JSON.stringify({ location: { name: "Test Loc" } }), { status: 200 });
        },
        persistTokens: async () => {
          throw new Error("database unavailable");
        },
      }
    );

    assert.match(result.redirectUrl, /reason=storage_failed/);
    assert.doesNotMatch(result.redirectUrl, /access-token-value|refresh-token-value/i);

    const debug = getLatestGhlOAuthDebug();
    assert.equal(debug?.databaseWriteOk, false);
    assert.equal(debug?.outcome, "storage_failed");
  }));
