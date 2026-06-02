import test from "node:test";
import assert from "node:assert/strict";
import { encryptGhlToken, decryptGhlToken } from "../../lib/ghl-token-encryption.js";
import {
  buildGhlOAuthAuthorizeUrl,
  refreshGhlOAuthTokens,
} from "./ghl-oauth-client.service.js";

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
