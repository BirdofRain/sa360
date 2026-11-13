import assert from "node:assert/strict";
import test from "node:test";

import { decideStaffGoogleStart } from "./staff-google-start-host.ts";

const BRANDED = "https://portal.lifeagentlaunch.com/staff/google/callback";
const PREVIOUS = "https://sa360-api-staging-coo57.ondigitalocean.app";

test("oauth starts only when the request host is the callback host", () => {
  assert.deepEqual(
    decideStaffGoogleStart({
      host: "portal.lifeagentlaunch.com",
      forwardedHost: null,
      forwardedProto: "https",
      redirectUri: BRANDED,
    }),
    { kind: "start" }
  );
  assert.deepEqual(
    decideStaffGoogleStart({
      host: "portal.lifeagentlaunch.com",
      forwardedHost: "evil.example",
      forwardedProto: "https",
      redirectUri: BRANDED,
    }),
    { kind: "start" }
  );
  assert.deepEqual(
    decideStaffGoogleStart({
      host: "localhost:3000",
      forwardedHost: null,
      forwardedProto: null,
      redirectUri: "http://localhost:3000/staff/google/callback",
    }),
    { kind: "start" }
  );
});

test("the previous ingress redirects to the branded start before oauth state", () => {
  assert.deepEqual(
    decideStaffGoogleStart({
      host: "sa360-api-staging-coo57.ondigitalocean.app",
      forwardedHost: "evil.example, portal.lifeagentlaunch.com",
      forwardedProto: "https",
      redirectUri: BRANDED,
    }),
    { kind: "redirect", location: "https://portal.lifeagentlaunch.com/staff/google/start" }
  );
  assert.equal(PREVIOUS.endsWith("ondigitalocean.app"), true);
});

test("a missing host falls back to the request url and still refuses a non-login callback", () => {
  assert.deepEqual(
    decideStaffGoogleStart({
      host: null,
      forwardedHost: null,
      forwardedProto: null,
      requestUrl: "https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/start",
      redirectUri: BRANDED,
    }),
    { kind: "redirect", location: "https://portal.lifeagentlaunch.com/staff/google/start" }
  );
  assert.deepEqual(
    decideStaffGoogleStart({
      host: null,
      forwardedHost: null,
      forwardedProto: null,
      redirectUri: BRANDED,
    }),
    { kind: "unavailable" }
  );
  assert.deepEqual(
    decideStaffGoogleStart({
      host: "portal.lifeagentlaunch.com",
      forwardedHost: null,
      forwardedProto: "https",
      redirectUri: null,
    }),
    { kind: "unavailable" }
  );
  assert.deepEqual(
    decideStaffGoogleStart({
      host: "portal.lifeagentlaunch.com",
      forwardedHost: null,
      forwardedProto: "https",
      redirectUri: "https://portal.lifeagentlaunch.com/staff/google/enroll/callback",
    }),
    { kind: "unavailable" }
  );
});
