import test from "node:test";
import assert from "node:assert/strict";
import { encryptGhlToken, decryptGhlToken } from "../../lib/ghl-token-encryption.js";
import { refreshGhlOAuthTokens } from "./ghl-oauth-client.service.js";

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
