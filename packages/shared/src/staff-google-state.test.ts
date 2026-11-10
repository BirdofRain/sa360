import assert from "node:assert/strict";
import test from "node:test";

import {
  STAFF_GOOGLE_STATE_REPLAY_PREFIX,
  STAFF_GOOGLE_STATE_REPLAY_TTL_SECONDS,
  STAFF_GOOGLE_STATE_TTL_SECONDS,
  createStaffGoogleState,
  staffGoogleStateReplayId,
  staffGoogleStateReplayKey,
  verifyStaffGoogleState,
} from "./staff-google-state.js";

const SECRET = "staff-session-secret-at-least-32-characters";
const REDIRECT = "https://admin.example/staff/google/callback";
const OTHER = "https://other.example/staff/google/callback";
const NOW = 1_800_000_000;

test("oauth state verification rejects a missing, mismatched, expired, redirected, or altered cookie", () => {
  const created = createStaffGoogleState({ redirectUri: REDIRECT, nowSec: NOW, secret: SECRET });
  assert.deepEqual(
    verifyStaffGoogleState({ token: undefined, queryState: created.claims.state, redirectUri: REDIRECT, nowSec: NOW, secret: SECRET }),
    { ok: false, code: "missing_state" }
  );
  assert.equal(
    verifyStaffGoogleState({
      token: created.token,
      queryState: "not-the-state-value-in-the-signed-cookie-at-all",
      redirectUri: REDIRECT,
      nowSec: NOW,
      secret: SECRET,
    }).code,
    "csrf"
  );
  const again = verifyStaffGoogleState({
    token: created.token,
    queryState: created.claims.state,
    redirectUri: REDIRECT,
    nowSec: NOW,
    secret: SECRET,
  });
  assert.equal(again.ok, true);
  assert.equal(
    verifyStaffGoogleState({
      token: created.token,
      queryState: created.claims.state,
      redirectUri: REDIRECT,
      nowSec: NOW,
      secret: SECRET,
    }).ok,
    true
  );
  assert.equal(
    verifyStaffGoogleState({
      token: created.token,
      queryState: created.claims.state,
      redirectUri: REDIRECT,
      nowSec: created.claims.exp,
      secret: SECRET,
    }).code,
    "expired"
  );
  assert.equal(
    verifyStaffGoogleState({
      token: created.token,
      queryState: created.claims.state,
      redirectUri: OTHER,
      nowSec: NOW,
      secret: SECRET,
    }).code,
    "redirect"
  );
  const broken = `${created.token.slice(0, -4)}aaaa`;
  assert.equal(
    verifyStaffGoogleState({
      token: broken,
      queryState: created.claims.state,
      redirectUri: REDIRECT,
      nowSec: NOW,
      secret: SECRET,
    }).code,
    "invalid_signature"
  );
});

test("the replay identifier hides the state and uses a bounded ttl", () => {
  const created = createStaffGoogleState({ redirectUri: REDIRECT, nowSec: NOW, secret: SECRET });
  const replayId = staffGoogleStateReplayId(created.claims.state);
  assert.equal(replayId.length, 64);
  assert.equal(replayId.includes(created.claims.state), false);
  assert.equal(staffGoogleStateReplayKey(created.claims.state), `${STAFF_GOOGLE_STATE_REPLAY_PREFIX}${replayId}`);
  assert.equal(staffGoogleStateReplayKey(created.claims.state).includes(created.claims.verifier), false);
  assert.equal(STAFF_GOOGLE_STATE_REPLAY_TTL_SECONDS, STAFF_GOOGLE_STATE_TTL_SECONDS);
});
