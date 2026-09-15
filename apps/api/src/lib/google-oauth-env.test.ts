import assert from "node:assert/strict";
import test from "node:test";

import { createPkceS256Challenge } from "./google-oauth-state.js";
import {
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_SCOPES,
  buildGoogleOAuthAuthorizeUrl,
  getGoogleOAuthConfig,
  isGoogleOAuthEnabled,
} from "./google-oauth-env.js";

test("A. Google OAuth flag defaults off and only case-insensitive true enables it", () => {
  assert.equal(isGoogleOAuthEnabled({}), false);
  assert.equal(isGoogleOAuthEnabled({ SA360_GOOGLE_OAUTH_ENABLED: "false" }), false);
  assert.equal(isGoogleOAuthEnabled({ SA360_GOOGLE_OAUTH_ENABLED: "1" }), false);
  assert.equal(isGoogleOAuthEnabled({ SA360_GOOGLE_OAUTH_ENABLED: " TRUE " }), true);
});

test("Google config is lazy and fails closed when required values are absent", () => {
  assert.equal(getGoogleOAuthConfig({}), null);
  assert.equal(
    getGoogleOAuthConfig({
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://api.example/callback",
      SA360_PORTAL_PUBLIC_BASE_URL: "https://portal.example",
    })?.clientId,
    "id"
  );
});

test("G-K. authorize URL has exact scopes, offline consent, and RFC 7636 S256", () => {
  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = createPkceS256Challenge(verifier);
  const raw = buildGoogleOAuthAuthorizeUrl({
    config: {
      clientId: "browser-client-id",
      redirectUri: "https://api.example/integrations/google/oauth/callback",
    },
    state: "opaque-state",
    codeChallenge: challenge,
  });
  const url = new URL(raw);
  assert.equal(url.origin + url.pathname, GOOGLE_OAUTH_AUTHORIZE_URL);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("scope"), GOOGLE_OAUTH_SCOPES.join(" "));
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...GOOGLE_OAUTH_SCOPES]);
  assert.equal([...GOOGLE_OAUTH_SCOPES].some((scope) => scope.includes("/auth/drive")), false);
  assert.equal(url.searchParams.has("client_secret"), false);
});
