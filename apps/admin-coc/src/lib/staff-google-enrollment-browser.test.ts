import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createStaffEnrollmentSecret } from "@sa360/shared/staff-enrollment";
import { createStaffGoogleState } from "@sa360/shared/staff-google-state";
import { STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";

import { completeStaffGoogleEnrollment, startStaffGoogleEnrollment } from "./staff-google-enrollment-browser.js";

const SECRET = "staff-session-secret-at-least-32-characters";
const SERVICE = "staff-google-service-secret-32-characters";
const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const REDIRECT = "https://admin.example/staff/google/enroll/callback";

function enabled(): NodeJS.ProcessEnv {
  return {
    SA360_STAFF_ENROLLMENT_ENABLED: "true",
    SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
    SA360_STAFF_GOOGLE_CLIENT_SECRET: "staff-client-secret-value",
    SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI: REDIRECT,
    SA360_STAFF_SESSION_SECRET: SECRET,
    SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
    SA360_API_INTERNAL_URL: "https://api.example",
  };
}

test("enrollment stays unavailable until its own settings exist and does not use the login redirect", async () => {
  const grant = createStaffEnrollmentSecret();
  const hidden = await startStaffGoogleEnrollment({ env: {}, enrollmentSecret: grant });
  assert.equal(hidden.kind, "unconfigured");
  const loginSettings = enabled();
  delete loginSettings.SA360_STAFF_ENROLLMENT_ENABLED;
  loginSettings.SA360_STAFF_GOOGLE_SIGNIN_ENABLED = "true";
  loginSettings.SA360_STAFF_GOOGLE_REDIRECT_URI = "https://admin.example/staff/google/callback";
  const stillHidden = await startStaffGoogleEnrollment({ env: loginSettings, enrollmentSecret: grant });
  assert.equal(stillHidden.kind, "unconfigured");
});

test("a rejected or unavailable invitation does not redirect to Google", async () => {
  const grant = createStaffEnrollmentSecret();
  const rejected = await startStaffGoogleEnrollment({
    env: enabled(),
    enrollmentSecret: grant,
    preview: async () => ({ ok: false, code: "rejected" }),
  });
  assert.equal(rejected.kind, "rejected");
  const unavailable = await startStaffGoogleEnrollment({
    env: enabled(),
    enrollmentSecret: grant,
    preview: async () => ({ ok: false, code: "unavailable" }),
  });
  assert.equal(unavailable.kind, "unavailable");
  const started = await startStaffGoogleEnrollment({
    env: enabled(),
    enrollmentSecret: grant,
    preview: async () => ({ ok: true }),
    nowSec: 1_800_000_000,
  });
  assert.equal(started.kind, "redirect");
  if (started.kind !== "redirect") return;
  assert.equal(started.location.startsWith("https://accounts.google.com/"), true);
  assert.equal(started.location.includes(grant), false);
  assert.equal(started.stateCookie.name, "sa360_staff_google_enroll");
  const login = createStaffGoogleState({
    redirectUri: "https://admin.example/staff/google/callback",
    secret: SECRET,
    nowSec: 1_800_000_000,
  });
  const replayed = await completeStaffGoogleEnrollment({
    env: enabled(),
    code: "auth-code",
    queryState: login.claims.state,
    stateCookie: login.token,
    nowSec: 1_800_000_000,
    claimState: async () => ({ ok: true }),
    bind: async () => ({ ok: true }),
  });
  assert.equal(replayed.kind, "denied");
});

test("redis or enrollment failure does not create a staff session", async () => {
  let exchanged = 0;
  let bound = 0;
  const grant = createStaffEnrollmentSecret();
  const started = await startStaffGoogleEnrollment({
    env: enabled(),
    enrollmentSecret: grant,
    preview: async () => ({ ok: true }),
    nowSec: 1_800_000_000,
  });
  assert.equal(started.kind, "redirect");
  if (started.kind !== "redirect") return;
  const state = started.stateCookie.value;
  const query = new URL(started.location).searchParams.get("state") ?? undefined;
  const unavailable = await completeStaffGoogleEnrollment({
    env: enabled(),
    code: "auth-code",
    queryState: query,
    stateCookie: state,
    nowSec: 1_800_000_000,
    claimState: async () => ({ ok: false, code: "state_unavailable" }),
    exchange: async () => {
      exchanged += 1;
      return { ok: true, idToken: "token" };
    },
    bind: async () => {
      bound += 1;
      return { ok: true };
    },
  });
  assert.equal(unavailable.kind, "unavailable");
  assert.equal(exchanged, 0);
  assert.equal(bound, 0);
  const enrolled = await completeStaffGoogleEnrollment({
    env: enabled(),
    code: "auth-code",
    queryState: query,
    stateCookie: state,
    nowSec: 1_800_000_000,
    claimState: async () => ({ ok: true }),
    exchange: async () => ({ ok: true, idToken: "header.payload.signature" }),
    bind: async (value) => {
      bound += 1;
      assert.equal(value.enrollmentSecret, grant);
      assert.equal("staffPrincipalId" in value, false);
      return { ok: true };
    },
  });
  assert.deepEqual(enrolled, { kind: "enrolled" });
  assert.equal("sessionToken" in enrolled, false);
  const callback = readFileSync(new URL("../app/staff/google/enroll/callback/route.ts", import.meta.url), "utf8");
  const login = readFileSync(new URL("../app/staff/google/callback/route.ts", import.meta.url), "utf8");
  assert.equal(callback.includes("sa360_staff_session"), false);
  assert.equal(callback.includes("STAFF_SESSION_COOKIE"), false);
  assert.equal(login.includes("staff-google-enrollment"), false);
  assert.equal(callback.includes(STAFF_GOOGLE_SERVICE_HEADER), false);
});
