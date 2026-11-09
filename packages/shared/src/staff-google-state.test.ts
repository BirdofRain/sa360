import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeStaffGoogleState,
  createStaffGoogleState,
  resetStaffGoogleStateConsumptionForTests,
} from "./staff-google-state.js";

const SECRET = "staff-session-secret-at-least-32-characters";
const REDIRECT = "https://admin.example/staff/google/callback";
const OTHER = "https://other.example/staff/google/callback";
const NOW = 1_800_000_000;

test("oauth state is single use and rejects a missing, mismatched, expired, or redirected cookie", () => {
  resetStaffGoogleStateConsumptionForTests();
  const created = createStaffGoogleState({ redirectUri: REDIRECT, nowSec: NOW, secret: SECRET });
  assert.deepEqual(
    consumeStaffGoogleState({ token: undefined, queryState: created.claims.state, redirectUri: REDIRECT, nowSec: NOW, secret: SECRET }),
    { ok: false, code: "missing_state" }
  );
  assert.deepEqual(
    consumeStaffGoogleState({
      token: created.token,
      queryState: "not-the-state-value-in-the-signed-cookie-at-all",
      redirectUri: REDIRECT,
      nowSec: NOW,
      secret: SECRET,
    }).code,
    "csrf"
  );
  resetStaffGoogleStateConsumptionForTests();
  const again = createStaffGoogleState({ redirectUri: REDIRECT, nowSec: NOW, secret: SECRET });
  const first = consumeStaffGoogleState({
    token: again.token,
    queryState: again.claims.state,
    redirectUri: REDIRECT,
    nowSec: NOW,
    secret: SECRET,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(
    consumeStaffGoogleState({
      token: again.token,
      queryState: again.claims.state,
      redirectUri: REDIRECT,
      nowSec: NOW,
      secret: SECRET,
    }),
    { ok: false, code: "reused_state" }
  );
  resetStaffGoogleStateConsumptionForTests();
  const expired = createStaffGoogleState({ redirectUri: REDIRECT, nowSec: NOW, secret: SECRET });
  assert.deepEqual(
    consumeStaffGoogleState({
      token: expired.token,
      queryState: expired.claims.state,
      redirectUri: REDIRECT,
      nowSec: expired.claims.exp,
      secret: SECRET,
    }),
    { ok: false, code: "expired" }
  );
  resetStaffGoogleStateConsumptionForTests();
  const redirected = createStaffGoogleState({ redirectUri: REDIRECT, nowSec: NOW, secret: SECRET });
  assert.equal(
    consumeStaffGoogleState({
      token: redirected.token,
      queryState: redirected.claims.state,
      redirectUri: OTHER,
      nowSec: NOW,
      secret: SECRET,
    }).code,
    "redirect"
  );
});
