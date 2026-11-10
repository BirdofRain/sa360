import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  STAFF_SESSION_REGISTRY_PREFIX,
  STAFF_SESSION_TTL_SECONDS,
  signStaffSession,
  staffSessionRegistryKey,
  verifyStaffSession,
} from "./staff-google-session.js";

const SECRET = "staff-session-secret-at-least-32-characters";
const PRINCIPAL = "c123456789012345678901234";
const GOOGLE_SUB = "102938475610293847561";
const NOW = 1_800_000_000;

test("a staff session names the principal and expires in eight hours", () => {
  const signed = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: GOOGLE_SUB,
    nowSec: NOW,
    sessionId: "session-id-0123456789abcd",
    secret: SECRET,
  });
  assert.equal(signed.token.startsWith("sf1."), true);
  assert.equal(signed.claims.exp, NOW + STAFF_SESSION_TTL_SECONDS);
  assert.equal("role" in signed.claims, false);
  const verified = verifyStaffSession(signed.token, { secret: SECRET, nowSec: NOW + 10 });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.claims.sub, PRINCIPAL);
  assert.equal(verified.claims.googleSub, GOOGLE_SUB);
  assert.deepEqual(Object.keys(verified.claims).sort(), ["exp", "googleSub", "iat", "jti", "sub", "typ", "v"]);
});

test("a staff session expires at the stated time and rejects a shared-password token", () => {
  const signed = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: GOOGLE_SUB,
    nowSec: NOW,
    secret: SECRET,
  });
  assert.deepEqual(verifyStaffSession(signed.token, { secret: SECRET, nowSec: signed.claims.exp }), {
    ok: false,
    code: "expired",
  });
  assert.deepEqual(verifyStaffSession("ac1.eyJ0eXAiOiJhZG1pbl9jb2MifQ.signature", { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "malformed",
  });
  assert.deepEqual(verifyStaffSession(signed.token, { secret: undefined, env: {}, nowSec: NOW }), {
    ok: false,
    code: "secret_unavailable",
  });
});

test("a staff session rejects a role claim and a substituted principal", () => {
  const claims = {
    exp: NOW + STAFF_SESSION_TTL_SECONDS,
    googleSub: GOOGLE_SUB,
    iat: NOW,
    jti: "session-id-0123456789abcd",
    role: "ADMIN",
    sub: PRINCIPAL,
    typ: "staff",
    v: 1,
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signed = `sf1.${body}`;
  const token = `${signed}.${createHmac("sha256", SECRET).update(signed).digest("base64url")}`;
  assert.deepEqual(verifyStaffSession(token, { secret: SECRET, nowSec: NOW }), { ok: false, code: "unsupported" });

  const valid = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: GOOGLE_SUB,
    nowSec: NOW,
    sessionId: "session-id-0123456789abcd",
    secret: SECRET,
  });
  const parts = valid.token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -1)}x`;
  assert.deepEqual(verifyStaffSession(tampered, { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_signature",
  });
});

test("the session registry key hides the session id and the signing secret", () => {
  const signed = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: GOOGLE_SUB,
    nowSec: NOW,
    sessionId: "session-id-0123456789abcd",
    secret: SECRET,
  });
  const key = staffSessionRegistryKey(signed.claims.jti);
  assert.equal(key.startsWith(STAFF_SESSION_REGISTRY_PREFIX), true);
  assert.equal(key.includes(signed.claims.jti), false);
  assert.equal(key.includes(signed.token), false);
  assert.equal(key.includes(SECRET), false);
});
