import assert from "node:assert/strict";
import test from "node:test";

import { createStaffEnrollmentSecret } from "./staff-enrollment.js";
import { createStaffEnrollmentState, verifyStaffEnrollmentState } from "./staff-google-enrollment-state.js";
import { createStaffGoogleState, verifyStaffGoogleState } from "./staff-google-state.js";

const SECRET = "staff-session-secret-at-least-32-characters";
const LOGIN = "https://admin.example/staff/google/callback";
const ENROLL = "https://admin.example/staff/google/enroll/callback";

test("enrollment state is purpose bound and hides nothing a login cookie can satisfy", () => {
  const grant = createStaffEnrollmentSecret();
  const enrollment = createStaffEnrollmentState({ redirectUri: ENROLL, grant, secret: SECRET, nowSec: 1_800_000_000 });
  const login = createStaffGoogleState({ redirectUri: LOGIN, secret: SECRET, nowSec: 1_800_000_000 });
  assert.equal(
    verifyStaffEnrollmentState({
      token: enrollment.token,
      queryState: enrollment.claims.state,
      redirectUri: ENROLL,
      nowSec: 1_800_000_000,
      secret: SECRET,
    }).ok,
    true
  );
  assert.equal(
    verifyStaffEnrollmentState({
      token: login.token,
      queryState: login.claims.state,
      redirectUri: ENROLL,
      nowSec: 1_800_000_000,
      secret: SECRET,
    }).ok,
    false
  );
  assert.equal(
    verifyStaffGoogleState({
      token: enrollment.token,
      queryState: enrollment.claims.state,
      redirectUri: LOGIN,
      nowSec: 1_800_000_000,
      secret: SECRET,
    }).ok,
    false
  );
  assert.equal(enrollment.claims.grant, grant);
  const payload = JSON.parse(Buffer.from(enrollment.token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.grant, grant);
});
