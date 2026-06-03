import test from "node:test";
import assert from "node:assert/strict";
import { encryptGhlToken, decryptGhlToken } from "../../lib/ghl-token-encryption.js";
import { assertNoSecretsInString } from "./ghl-oauth-callback-log.js";
import {
  buildGhlOAuthAuthorizeUrl,
  exchangeGhlOAuthAuthorizationCodeDetailed,
  refreshGhlOAuthTokens,
} from "./ghl-oauth-client.service.js";

type CapturedTokenRequest = {
  url: string;
  headers: Headers;
  body: URLSearchParams;
};

function captureTokenFetch(
  handler: () => Response
): { fetchImpl: typeof fetch; last: () => CapturedTokenRequest | undefined } {
  let captured: CapturedTokenRequest | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const merged = new Headers(
      input instanceof Request ? input.headers : undefined
    );
    if (init?.headers) {
      const extra = new Headers(init.headers);
      extra.forEach((value, key) => merged.set(key, value));
    }
    const rawBody = init?.body ?? (input instanceof Request ? input.body : undefined);
    assert.ok(rawBody instanceof URLSearchParams, "token body must be URLSearchParams");
    captured = { url, headers: merged, body: rawBody };
    return handler();
  };
  return { fetchImpl: fetchImpl as typeof fetch, last: () => captured };
}

function readFormBody(body: URLSearchParams): Record<string, string> {
  return Object.fromEntries(body.entries());
}

const TEST_REDIRECT_URI =
  "https://sa360-api-staging-coo57.ondigitalocean.app/integrations/oauth/callback";
const TEST_SCOPES = "contacts.readonly contacts.write locations.readonly";

function withGhlOAuthEnv(
  run: () => void | Promise<void>,
  extra?: Partial<Record<string, string | undefined>>
): Promise<void> {
  const keys = [
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_OAUTH_SCOPES",
    "GHL_OAUTH_AUTHORIZE_BASE_URL",
    "GHL_OAUTH_VERSION_ID",
    "GHL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];

  process.env.GHL_OAUTH_CLIENT_ID = extra?.GHL_OAUTH_CLIENT_ID ?? "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = extra?.GHL_OAUTH_CLIENT_SECRET ?? "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = extra?.GHL_OAUTH_REDIRECT_URI ?? TEST_REDIRECT_URI;
  process.env.GHL_OAUTH_SCOPES = extra?.GHL_OAUTH_SCOPES ?? TEST_SCOPES;
  process.env.GHL_OAUTH_AUTHORIZE_BASE_URL =
    extra?.GHL_OAUTH_AUTHORIZE_BASE_URL ??
    "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation";
  process.env.GHL_TOKEN_ENCRYPTION_KEY =
    extra?.GHL_TOKEN_ENCRYPTION_KEY ?? "test-encryption-key-for-unit-tests-only";
  if (extra && "GHL_OAUTH_VERSION_ID" in extra) {
    if (extra.GHL_OAUTH_VERSION_ID) process.env.GHL_OAUTH_VERSION_ID = extra.GHL_OAUTH_VERSION_ID;
    else delete process.env.GHL_OAUTH_VERSION_ID;
  } else {
    delete process.env.GHL_OAUTH_VERSION_ID;
  }

  return Promise.resolve(run()).finally(() => {
    for (const k of keys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
  });
}

test("buildGhlOAuthAuthorizeUrl includes scope, redirect_uri, client_id, and state", () =>
  withGhlOAuthEnv(() => {
    const state = "signed-state-token";
    const url = buildGhlOAuthAuthorizeUrl(state);
    const parsed = new URL(url);

    assert.equal(
      parsed.origin + parsed.pathname,
      "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation"
    );
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("redirect_uri"), TEST_REDIRECT_URI);
    assert.equal(parsed.searchParams.get("client_id"), "client_id_test");
    assert.equal(parsed.searchParams.get("state"), state);

    const scope = parsed.searchParams.get("scope");
    assert.ok(scope && scope.length > 0, "scope must be non-empty");
    assert.equal(scope, TEST_SCOPES);

    assert.match(parsed.search, /scope=contacts\.readonly%20contacts\.write%20locations\.readonly/);
    assert.doesNotMatch(parsed.search, /client_secret|access_token|refresh_token/i);
  }));

test("buildGhlOAuthAuthorizeUrl includes version_id when GHL_OAUTH_VERSION_ID is set", () =>
  withGhlOAuthEnv(
    () => {
      const url = buildGhlOAuthAuthorizeUrl("state");
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("version_id"), "69eb83165d87c883491f3a2c");
    },
    { GHL_OAUTH_VERSION_ID: "69eb83165d87c883491f3a2c" }
  ));

test("buildGhlOAuthAuthorizeUrl omits version_id when GHL_OAUTH_VERSION_ID is blank", () =>
  withGhlOAuthEnv(
    () => {
      const url = buildGhlOAuthAuthorizeUrl("state");
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("version_id"), null);
    },
    { GHL_OAUTH_VERSION_ID: "" }
  ));

test("buildGhlOAuthAuthorizeUrl fails when GHL_OAUTH_SCOPES is missing", () =>
  withGhlOAuthEnv(
    () => {
      assert.throws(
        () => buildGhlOAuthAuthorizeUrl("state"),
        /GHL_OAUTH_SCOPES is not configured/
      );
    },
    { GHL_OAUTH_SCOPES: "" }
  ));

test("authorization code exchange sends application/x-www-form-urlencoded", () =>
  withGhlOAuthEnv(async () => {
    const { fetchImpl, last } = captureTokenFetch(() =>
      new Response(
        JSON.stringify({
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expires_in: 3600,
          locationId: "loc_exchange",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const outcome = await exchangeGhlOAuthAuthorizationCodeDetailed("auth-code-123", fetchImpl);
    assert.equal(outcome.ok, true);

    const req = last();
    assert.ok(req);
    assert.match(req!.url, /\/oauth\/token$/);
    assert.equal(req!.headers.get("Content-Type"), "application/x-www-form-urlencoded");
    assert.equal(req!.headers.get("Accept"), "application/json");

    const form = readFormBody(req!.body);
    assert.equal(form.grant_type, "authorization_code");
    assert.equal(form.code, "auth-code-123");
    assert.equal(form.redirect_uri, TEST_REDIRECT_URI);
    assert.equal(form.client_id, "client_id_test");
    assert.equal(form.client_secret, "client_secret_test");

    const serialized = req!.body.toString();
    assert.match(serialized, /grant_type=authorization_code/);
    assert.doesNotMatch(serialized, /access-token-value|refresh-token-value/i);
  }));

test("authorization code exchange returns safe error on 400 without exposing secrets", () =>
  withGhlOAuthEnv(async () => {
    const outcome = await exchangeGhlOAuthAuthorizationCodeDetailed(
      "bad-code",
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            access_token: "must-not-leak",
            client_secret: "must-not-leak",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.httpStatus, 400);
    assertNoSecretsInString(outcome.errorMessage);
    assert.doesNotMatch(outcome.errorMessage, /must-not-leak|client_secret_test/i);
  }));

test("refresh token exchange sends application/x-www-form-urlencoded", async () => {
  const prevId = process.env.GHL_OAUTH_CLIENT_ID;
  const prevSecret = process.env.GHL_OAUTH_CLIENT_SECRET;
  const prevRedirect = process.env.GHL_OAUTH_REDIRECT_URI;
  const prevKey = process.env.GHL_TOKEN_ENCRYPTION_KEY;
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = "https://example.com/integrations/oauth/callback";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";

  const oldRefresh = "old_refresh_token";
  const encryptedRefresh = encryptGhlToken(oldRefresh);

  const { fetchImpl, last } = captureTokenFetch(() =>
    new Response(
      JSON.stringify({
        access_token: "new_access_token",
        refresh_token: "new_refresh_token_rotated",
        expires_in: 3600,
        scope: "contacts.readonly",
        userType: "Location",
        locationId: "loc_1",
      }),
      { status: 200 }
    )
  );

  try {
    await refreshGhlOAuthTokens(
      { locationId: "loc_1", refreshTokenEncrypted: encryptedRefresh },
      (enc) => decryptGhlToken(enc),
      fetchImpl
    );

    const req = last();
    assert.ok(req);
    assert.equal(req!.headers.get("Content-Type"), "application/x-www-form-urlencoded");
    const form = readFormBody(req!.body);
    assert.equal(form.grant_type, "refresh_token");
    assert.equal(form.refresh_token, oldRefresh);
    assert.equal(form.client_id, "client_id_test");
    assert.equal(form.client_secret, "client_secret_test");
    assert.match(req!.body.toString(), /grant_type=refresh_token/);
    assert.doesNotMatch(req!.body.toString(), /new_access_token|new_refresh_token_rotated/);
  } finally {
    if (prevId !== undefined) process.env.GHL_OAUTH_CLIENT_ID = prevId;
    else delete process.env.GHL_OAUTH_CLIENT_ID;
    if (prevSecret !== undefined) process.env.GHL_OAUTH_CLIENT_SECRET = prevSecret;
    else delete process.env.GHL_OAUTH_CLIENT_SECRET;
    if (prevRedirect !== undefined) process.env.GHL_OAUTH_REDIRECT_URI = prevRedirect;
    else delete process.env.GHL_OAUTH_REDIRECT_URI;
    if (prevKey !== undefined) process.env.GHL_TOKEN_ENCRYPTION_KEY = prevKey;
    else delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
  }
});

test("refreshGhlOAuthTokens stores rotated refresh token from response", async () => {
  const prevId = process.env.GHL_OAUTH_CLIENT_ID;
  const prevSecret = process.env.GHL_OAUTH_CLIENT_SECRET;
  const prevRedirect = process.env.GHL_OAUTH_REDIRECT_URI;
  const prevKey = process.env.GHL_TOKEN_ENCRYPTION_KEY;
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI = "https://example.com/integrations/oauth/callback";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";

  const oldRefresh = "old_refresh_token";
  const newRefresh = "new_refresh_token_rotated";
  const newAccess = "new_access_token";

  const encryptedRefresh = encryptGhlToken(oldRefresh);

  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        access_token: newAccess,
        refresh_token: newRefresh,
        expires_in: 3600,
        scope: "contacts.readonly",
        userType: "Location",
        locationId: "loc_1",
      }),
      { status: 200 }
    );

  try {
    const result = await refreshGhlOAuthTokens(
      {
        locationId: "loc_1",
        refreshTokenEncrypted: encryptedRefresh,
      },
      (enc) => {
        assert.equal(decryptGhlToken(enc), oldRefresh);
        return oldRefresh;
      },
      fetchImpl as typeof fetch
    );
    assert.equal(result.accessToken, newAccess);
    assert.equal(result.refreshToken, newRefresh);
  } finally {
    if (prevId !== undefined) process.env.GHL_OAUTH_CLIENT_ID = prevId;
    else delete process.env.GHL_OAUTH_CLIENT_ID;
    if (prevSecret !== undefined) process.env.GHL_OAUTH_CLIENT_SECRET = prevSecret;
    else delete process.env.GHL_OAUTH_CLIENT_SECRET;
    if (prevRedirect !== undefined) process.env.GHL_OAUTH_REDIRECT_URI = prevRedirect;
    else delete process.env.GHL_OAUTH_REDIRECT_URI;
    if (prevKey !== undefined) process.env.GHL_TOKEN_ENCRYPTION_KEY = prevKey;
    else delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
  }
});
