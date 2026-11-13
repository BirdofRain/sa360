import assert from "node:assert/strict";
import test from "node:test";

import {
  exchangeStaffGoogleCode,
  parseStaffGoogleRedirectUri,
  parseStaffSignInUrl,
  readStaffGoogleBrowserConfig,
  staffGoogleAuthorizeUrl,
  staffGoogleCodeChallenge,
  staffGoogleSignInEnabled,
} from "./staff-google-oidc.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "staff-test-client-secret";
const REDIRECT = "https://admin.example/staff/google/callback";
const VERIFIER = "a".repeat(43);

function enabledEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
    SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
    SA360_STAFF_GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    SA360_STAFF_GOOGLE_REDIRECT_URI: REDIRECT,
    ...extra,
  };
}

test("staff google configuration fails closed", () => {
  assert.equal(staffGoogleSignInEnabled({}), false);
  assert.equal(staffGoogleSignInEnabled({ SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "TRUE" }), false);
  assert.equal(readStaffGoogleBrowserConfig({ SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true" }), null);
  assert.equal(readStaffGoogleBrowserConfig(enabledEnv({ SA360_STAFF_GOOGLE_CLIENT_SECRET: "" })), null);
  assert.equal(parseStaffGoogleRedirectUri("http://evil.example/staff/google/callback"), null);
  assert.equal(parseStaffGoogleRedirectUri("https://admin.example/integrations/google/oauth/callback"), null);
  assert.equal(parseStaffGoogleRedirectUri(`${REDIRECT}?next=https://evil.example`), null);
  assert.equal(parseStaffGoogleRedirectUri(REDIRECT), REDIRECT);
});

test("invitation sign-in links accept only the branded origin or localhost", () => {
  const approved = "https://portal.lifeagentlaunch.com/staff/google/start";
  const previousIngress = "https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/start";
  assert.equal(parseStaffSignInUrl(approved), approved);
  assert.equal(parseStaffSignInUrl(previousIngress), null);
  assert.equal(parseStaffSignInUrl("http://localhost:3000/staff/google/start"), "http://localhost:3000/staff/google/start");
  assert.equal(parseStaffSignInUrl("https://evil.example/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl("https://admin.example/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl("https://portal.lifeagentlaunch.com.evil.com/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl(`${approved}#fragment`), null);
  assert.equal(parseStaffSignInUrl(`${approved}?code=secret`), null);
});

test("the authorize request is a dedicated code flow with PKCE and no offline access", () => {
  const challenge = staffGoogleCodeChallenge(VERIFIER);
  const url = new URL(
    staffGoogleAuthorizeUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      state: "b".repeat(43),
      nonce: "c".repeat(43),
      codeChallenge: challenge,
    })
  );
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.has("access_type"), false);
  assert.equal(url.search.includes("offline"), false);
  assert.equal(url.search.includes("spreadsheet"), false);
  assert.equal(url.search.includes("drive"), false);
});

test("code exchange keeps the configured redirect and drops a refresh token", async () => {
  let body = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    body = String(init?.body);
    return new Response(
      JSON.stringify({
        id_token: "header.payload.signature",
        access_token: "should-not-leave-this-function",
        refresh_token: "should-not-be-stored",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const config = readStaffGoogleBrowserConfig(enabledEnv());
  assert.ok(config);
  const exchanged = await exchangeStaffGoogleCode({
    code: "authorization-code",
    verifier: VERIFIER,
    config: config!,
    fetchImpl,
  });
  assert.deepEqual(exchanged, { ok: true, idToken: "header.payload.signature" });
  assert.equal(body.includes("refresh_token"), false);
  assert.equal(body.includes(`redirect_uri=${encodeURIComponent(REDIRECT)}`), true);
  assert.equal(body.includes("https://evil.example"), false);
});
