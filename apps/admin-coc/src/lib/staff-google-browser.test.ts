import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAdminCocSessionToken,
  parseAdminCocSessionToken,
} from "./admin-coc-session.ts";
import { ADMIN_COC_ROLE_ADMIN } from "./admin-coc-observer-access.ts";
import {
  completeStaffGoogleCallback,
  staffLogoutClearCookie,
  startStaffGoogleSignIn,
} from "./staff-google-browser.ts";
import { signStaffSession, verifyStaffSession } from "@sa360/shared/staff-google-session";

const SECRET = "staff-session-secret-at-least-32-characters";
const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const REDIRECT = "https://admin.example/staff/google/callback";
const PRINCIPAL = "c123456789012345678901234";
const SUB = "102938475610293847561";
const NOW = 1_800_000_000;

const ENV: NodeJS.ProcessEnv = {
  SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
  SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
  SA360_STAFF_GOOGLE_CLIENT_SECRET: "staff-test-client-secret",
  SA360_STAFF_GOOGLE_REDIRECT_URI: REDIRECT,
  SA360_STAFF_SESSION_SECRET: SECRET,
};

test("google staff sign-in stays unavailable until the flag and secrets exist", async () => {
  let called = false;
  const exchange = async () => {
    called = true;
    return { ok: false as const, code: "exchange_failed" as const };
  };
  assert.equal(startStaffGoogleSignIn({ env: {}, nowSec: NOW }).kind, "unavailable");
  assert.equal(startStaffGoogleSignIn({ env: { ...ENV, SA360_STAFF_GOOGLE_CLIENT_SECRET: "" }, nowSec: NOW }).kind, "unavailable");
  const callback = await completeStaffGoogleCallback({
    env: {},
    code: "authorization-code",
    queryState: "state",
    stateCookie: "cookie",
    nowSec: NOW,
    exchange,
  });
  assert.deepEqual(callback, { kind: "unavailable" });
  assert.equal(called, false);
});

test("the start redirect is the dedicated google endpoint and the callback binds only a resolved principal", async () => {
  const started = startStaffGoogleSignIn({ env: ENV, nowSec: NOW });
  assert.equal(started.kind, "redirect");
  if (started.kind !== "redirect") return;
  const location = new URL(started.location);
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(location.searchParams.get("scope"), "openid email");
  assert.equal(location.search.includes("offline"), false);
  assert.equal(started.stateCookie.httpOnly, true);
  assert.equal(started.stateCookie.sameSite, "lax");

  let exchangedRedirect = "";
  const outcome = await completeStaffGoogleCallback({
    env: ENV,
    code: "authorization-code",
    queryState: location.searchParams.get("state") ?? undefined,
    stateCookie: started.stateCookie.value,
    nowSec: NOW,
    exchange: async (input) => {
      exchangedRedirect = input.config.redirectUri;
      return { ok: true, idToken: "header.payload.signature" };
    },
    resolve: async (value) => {
      assert.equal(value.nonce, location.searchParams.get("nonce"));
      return { ok: true, staffPrincipalId: PRINCIPAL, googleSub: SUB };
    },
  });
  assert.equal(exchangedRedirect, REDIRECT);
  assert.equal(outcome.kind, "signed_in");
  if (outcome.kind !== "signed_in") return;
  const session = verifyStaffSession(outcome.sessionToken, { secret: SECRET, nowSec: NOW });
  assert.equal(session.ok, true);
  if (!session.ok) return;
  assert.equal(session.claims.sub, PRINCIPAL);
  assert.equal("role" in session.claims, false);

  const reused = await completeStaffGoogleCallback({
    env: ENV,
    code: "authorization-code",
    queryState: location.searchParams.get("state") ?? undefined,
    stateCookie: started.stateCookie.value,
    nowSec: NOW,
    exchange: async () => {
      throw new Error("reused state must not exchange");
    },
    resolve: async () => {
      throw new Error("reused state must not resolve");
    },
  });
  assert.deepEqual(reused, { kind: "denied", reason: "reused_state" });
});

test("a mismatched state is denied before token exchange", async () => {
  const started = startStaffGoogleSignIn({ env: ENV, nowSec: NOW });
  if (started.kind !== "redirect") throw new Error("expected redirect");
  let called = false;
  const outcome = await completeStaffGoogleCallback({
    env: ENV,
    code: "authorization-code",
    queryState: "attacker-state-value-that-does-not-match-cookie",
    stateCookie: started.stateCookie.value,
    nowSec: NOW,
    exchange: async () => {
      called = true;
      return { ok: false, code: "exchange_failed" };
    },
    resolve: async () => {
      throw new Error("mismatched state must not resolve");
    },
  });
  assert.equal(outcome.kind, "denied");
  if (outcome.kind === "denied") assert.equal(outcome.reason, "csrf");
  assert.equal(called, false);
});

test("a shared-password session cannot impersonate staff and logout clears only the staff cookie", () => {
  const admin = createAdminCocSessionToken(NOW, SECRET, ADMIN_COC_ROLE_ADMIN);
  assert.ok(admin);
  assert.equal(verifyStaffSession(admin, { secret: SECRET, nowSec: NOW }).ok, false);
  const staff = signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: NOW, secret: SECRET });
  assert.equal(parseAdminCocSessionToken(staff.token, NOW, SECRET), null);
  const clear = staffLogoutClearCookie({ NODE_ENV: "production" });
  assert.equal(clear.name, "sa360_staff_session");
  assert.equal(clear.maxAge, 0);
  assert.equal(clear.httpOnly, true);
  assert.equal(clear.secure, true);
  assert.equal(clear.sameSite, "lax");

  const callback = readFileSync(new URL("../app/staff/google/callback/route.ts", import.meta.url), "utf8");
  const logout = readFileSync(new URL("../app/staff/google/logout/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/staff/page.tsx", import.meta.url), "utf8");
  assert.equal(callback.includes("redirect_uri"), false);
  assert.equal(callback.includes("error=denied"), true);
  assert.equal(callback.includes("reason"), false);
  assert.equal(logout.includes("ADMIN_COC_SESSION_COOKIE"), false);
  assert.equal(logout.includes("staffLogoutClearCookie"), true);
  assert.equal(page.includes("notFound"), true);
  assert.equal(page.includes("facebook_association_correction"), false);
  assert.equal(page.includes("ADMIN_COC_SESSION_COOKIE"), false);
});
