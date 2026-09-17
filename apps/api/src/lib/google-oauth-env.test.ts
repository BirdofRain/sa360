import assert from "node:assert/strict";
import test from "node:test";

import { createPkceS256Challenge } from "./google-oauth-state.js";
import {
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_SCOPES,
  buildGoogleOAuthAuthorizeUrl,
  buildGooglePortalRedirect,
  getGoogleOAuthClientCredentials,
  getGoogleOAuthConfig,
  isGoogleOAuthEnabled,
  parseTrustedPortalPublicOrigin,
} from "./google-oauth-env.js";

test("A. Google OAuth flag defaults off and only case-insensitive true enables it", () => {
  assert.equal(isGoogleOAuthEnabled({}), false);
  assert.equal(isGoogleOAuthEnabled({ SA360_GOOGLE_OAUTH_ENABLED: "false" }), false);
  assert.equal(isGoogleOAuthEnabled({ SA360_GOOGLE_OAUTH_ENABLED: "1" }), false);
  assert.equal(isGoogleOAuthEnabled({ SA360_GOOGLE_OAUTH_ENABLED: " TRUE " }), true);
});

test("Google OAuth client credentials do not require the OAuth enable flag", () => {
  assert.equal(getGoogleOAuthClientCredentials({}), null);
  assert.deepEqual(
    getGoogleOAuthClientCredentials({
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      SA360_GOOGLE_OAUTH_ENABLED: "false",
    }),
    { clientId: "id", clientSecret: "secret" }
  );
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

test("malformed portal public base fails closed and is not used as a redirect origin", () => {
  const required = {
    GOOGLE_OAUTH_CLIENT_ID: "id",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://api.example/callback",
  };
  assert.equal(parseTrustedPortalPublicOrigin("not-a-url"), null);
  assert.equal(parseTrustedPortalPublicOrigin("https://portal.test@evil.example"), null);
  assert.equal(parseTrustedPortalPublicOrigin("ftp://portal.test"), null);
  assert.equal(parseTrustedPortalPublicOrigin("//evil.example"), null);
  assert.equal(parseTrustedPortalPublicOrigin("https://portal.example/app/"), "https://portal.example");
  assert.equal(getGoogleOAuthConfig({ ...required, SA360_PORTAL_PUBLIC_BASE_URL: "not-a-url" }), null);
  assert.equal(
    getGoogleOAuthConfig({ ...required, SA360_PORTAL_PUBLIC_BASE_URL: "https://portal.test@evil.example" }),
    null
  );
});

test("callback redirects stay on the configured portal origin", () => {
  assert.equal(
    buildGooglePortalRedirect("https://portal.test", "/portal/orders", "connected"),
    "https://portal.test/portal/orders?google=connected"
  );
  assert.equal(
    buildGooglePortalRedirect("https://portal.test", "https://evil.example", "connected"),
    "https://portal.test/portal/account?google=connected"
  );
  assert.equal(
    buildGooglePortalRedirect("https://portal.test", "//evil.example", "error"),
    "https://portal.test/portal/account?google=error"
  );
  assert.equal(
    buildGooglePortalRedirect("https://portal.test", "/portal/../admin", "connected"),
    "https://portal.test/portal/account?google=connected"
  );
  assert.equal(
    buildGooglePortalRedirect("https://portal.test", "/\\evil.example", "connected"),
    "https://portal.test/portal/account?google=connected"
  );
  assert.throws(() => buildGooglePortalRedirect("not-a-url", "/portal/account", "error"));
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
