import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createClientPortalAssertion } from "./client-portal-assertion.js";
import {
  canonicalStaffAssertionJson,
  STAFF_ASSERTION_AUDIENCE,
  STAFF_ASSERTION_FAILURES,
  STAFF_ASSERTION_HEADER,
  STAFF_ASSERTION_ISSUER,
  STAFF_ASSERTION_PURPOSE,
  STAFF_ASSERTION_SECRET_ENV,
  STAFF_ASSERTION_TTL_SECONDS,
  STAFF_ASSERTION_TOKEN_PREFIX,
  StaffAssertionError,
  signStaffAssertion,
  verifyStaffAssertion,
  type StaffAssertionClaims,
} from "./staff-assertion.js";

const SECRET = "staff-assertion-test-secret-32chars-min";
const OTHER_SECRET = "different-staff-assertion-secret-32ch";
const ADA = "c0123456789abcdefghijklmn";
const GRACE = "czzzzzzzzzzzzzzzzzzzzzzzz";
const NOW = 1_700_000_000;

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: STAFF_ASSERTION_AUDIENCE,
    exp: NOW + STAFF_ASSERTION_TTL_SECONDS,
    iat: NOW,
    iss: STAFF_ASSERTION_ISSUER,
    jti: "assertion-id-0123456789abcd",
    purpose: STAFF_ASSERTION_PURPOSE,
    sub: ADA,
    v: 1,
    ...overrides,
  };
}

function sealRaw(json: string, secret = SECRET): string {
  const body = Buffer.from(json, "utf8").toString("base64url");
  const signed = `${STAFF_ASSERTION_TOKEN_PREFIX}.${body}`;
  const signature = createHmac("sha256", secret).update(signed, "utf8").digest("base64url");
  return `${signed}.${signature}`;
}

function forged(overrides: Record<string, unknown> = {}, secret = SECRET): string {
  return sealRaw(canonicalStaffAssertionJson(claims(overrides)), secret);
}

test("a signed staff assertion verifies and can be verified again", () => {
  const minted = signStaffAssertion({
    staffPrincipalId: ADA,
    assertionId: "assertion-id-0123456789abcd",
    nowSec: NOW,
    secret: SECRET,
  });
  const first = verifyStaffAssertion(minted.token, { secret: SECRET, nowSec: NOW, staffPrincipalId: ADA });
  const second = verifyStaffAssertion(minted.token, { secret: SECRET, nowSec: NOW + 59, staffPrincipalId: ADA });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.claims, second.claims);
  assert.equal(first.claims.sub, ADA);
  assert.equal(first.claims.jti, "assertion-id-0123456789abcd");
  assert.equal(first.claims.exp - first.claims.iat, STAFF_ASSERTION_TTL_SECONDS);
  assert.equal(first.claims.iss, STAFF_ASSERTION_ISSUER);
  assert.equal(first.claims.aud, STAFF_ASSERTION_AUDIENCE);
  assert.equal(first.claims.purpose, STAFF_ASSERTION_PURPOSE);
  assert.equal(canonicalStaffAssertionJson(first.claims), canonicalStaffAssertionJson(claims()));
  const decoded = JSON.parse(
    Buffer.from(minted.token.split(".")[1] ?? "", "base64url").toString("utf8")
  ) as StaffAssertionClaims;
  assert.deepEqual(Object.keys(decoded), [...Object.keys(decoded)].sort());
  assert.equal(JSON.stringify(decoded).includes("email"), false);
});

test("minted assertion ids differ and a substituted principal fails", () => {
  const first = signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, secret: SECRET });
  const second = signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, secret: SECRET });
  assert.notEqual(first.claims.jti, second.claims.jti);
  const parts = first.token.split(".");
  const body = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  body.sub = GRACE;
  const resigned = sealRaw(JSON.stringify(body)).split(".");
  const substituted = `${resigned[0]}.${resigned[1]}.${parts[2]}`;
  assert.deepEqual(verifyStaffAssertion(substituted, { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_signature",
  });
  assert.deepEqual(
    verifyStaffAssertion(first.token, { secret: SECRET, nowSec: NOW, staffPrincipalId: GRACE }),
    { ok: false, code: "principal_mismatch" }
  );
});

test("signature, secret, issuer, audience, and purpose failures stay distinct", () => {
  const minted = signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, secret: SECRET });
  const flipped = `${minted.token.slice(0, -1)}${minted.token.endsWith("a") ? "b" : "a"}`;
  assert.equal(verifyStaffAssertion(flipped, { secret: SECRET, nowSec: NOW }).ok, false);
  assert.equal(verifyStaffAssertion(flipped, { secret: SECRET, nowSec: NOW }).ok === false && verifyStaffAssertion(flipped, { secret: SECRET, nowSec: NOW }).code, "invalid_signature");
  assert.deepEqual(verifyStaffAssertion(minted.token, { secret: OTHER_SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_signature",
  });
  assert.deepEqual(verifyStaffAssertion(`${minted.token}x`, { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_signature",
  });
  assert.deepEqual(verifyStaffAssertion(forged({ iss: "SA360 API" }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "wrong_issuer",
  });
  assert.deepEqual(verifyStaffAssertion(forged({ aud: "SA360 Admin C.O.C." }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "wrong_audience",
  });
  assert.deepEqual(verifyStaffAssertion(forged({ purpose: "facebook_association_correction" }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "wrong_purpose",
  });
});

test("subject and assertion id are required and cannot be an email or an operator label", () => {
  const { sub: _sub, ...withoutSubject } = claims();
  const { jti: _jti, ...withoutAssertion } = claims();
  assert.deepEqual(verifyStaffAssertion(sealRaw(canonicalStaffAssertionJson(withoutSubject)), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "missing_subject",
  });
  assert.deepEqual(verifyStaffAssertion(sealRaw(canonicalStaffAssertionJson(withoutAssertion)), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "missing_assertion_id",
  });
  assert.throws(
    () => signStaffAssertion({ staffPrincipalId: "ada@example.com", nowSec: NOW, secret: SECRET }),
    (error: unknown) => error instanceof StaffAssertionError && error.code === "malformed"
  );
  assert.deepEqual(verifyStaffAssertion(forged({ sub: "ada@example.com" }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_subject",
  });
  assert.deepEqual(verifyStaffAssertion(forged({ sub: "sam" }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_subject",
  });
  assert.deepEqual(verifyStaffAssertion(forged({ jti: "short" }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_assertion_id",
  });
});

test("expiration, future issue, version, and schema failures are rejected", () => {
  const minted = signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, secret: SECRET });
  assert.deepEqual(verifyStaffAssertion(minted.token, { secret: SECRET, nowSec: NOW + STAFF_ASSERTION_TTL_SECONDS }), {
    ok: false,
    code: "expired",
  });
  assert.equal(verifyStaffAssertion(minted.token, { secret: SECRET, nowSec: NOW + 30 }).ok, true);
  assert.deepEqual(verifyStaffAssertion(forged({ iat: NOW + 31, exp: NOW + 31 + STAFF_ASSERTION_TTL_SECONDS }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "issued_in_future",
  });
  assert.equal(
    verifyStaffAssertion(forged({ iat: NOW + 30, exp: NOW + 30 + STAFF_ASSERTION_TTL_SECONDS }), { secret: SECRET, nowSec: NOW }).ok,
    true
  );
  assert.deepEqual(verifyStaffAssertion(forged({ v: 2 }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "unsupported_version",
  });
  assert.deepEqual(verifyStaffAssertion(forged({ exp: NOW + 3600 }), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "malformed",
  });
  const extra = claims({ email: "ada@example.com" });
  assert.deepEqual(verifyStaffAssertion(sealRaw(canonicalStaffAssertionJson(extra)), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "unexpected_field",
  });
  const { aud: _aud, ...missingAudience } = claims();
  assert.deepEqual(verifyStaffAssertion(sealRaw(canonicalStaffAssertionJson(missingAudience)), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "missing_field",
  });
  const reordered = `{"v":1,"sub":"${ADA}","purpose":"${STAFF_ASSERTION_PURPOSE}","jti":"assertion-id-0123456789abcd","iss":"${STAFF_ASSERTION_ISSUER}","iat":${NOW},"exp":${NOW + STAFF_ASSERTION_TTL_SECONDS},"aud":"${STAFF_ASSERTION_AUDIENCE}"}`;
  assert.deepEqual(verifyStaffAssertion(sealRaw(reordered), { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "not_canonical",
  });
});

test("missing or foreign signing material fails closed", () => {
  const minted = signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, secret: SECRET });
  assert.throws(
    () => signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, env: {} }),
    (error: unknown) => error instanceof StaffAssertionError && error.code === "secret_unavailable"
  );
  assert.deepEqual(verifyStaffAssertion(minted.token, { env: {}, nowSec: NOW }), {
    ok: false,
    code: "secret_unavailable",
  });
  assert.deepEqual(verifyStaffAssertion(minted.token, { secret: "", nowSec: NOW }), {
    ok: false,
    code: "secret_unavailable",
  });
  const foreign = {
    ADMIN_API_KEY: OTHER_SECRET,
    ADMIN_COC_SESSION_SECRET: OTHER_SECRET,
    SA360_ASSOCIATION_CORRECTION_SNAPSHOT_SECRET: OTHER_SECRET,
    SA360_ADMIN_KEY: OTHER_SECRET,
  };
  assert.throws(
    () => signStaffAssertion({ staffPrincipalId: ADA, nowSec: NOW, env: foreign }),
    (error: unknown) => error instanceof StaffAssertionError && error.code === "secret_unavailable"
  );
  assert.deepEqual(verifyStaffAssertion(minted.token, { env: foreign, nowSec: NOW }), {
    ok: false,
    code: "secret_unavailable",
  });
  assert.deepEqual(verifyStaffAssertion(minted.token, { secret: OTHER_SECRET, nowSec: NOW }), {
    ok: false,
    code: "invalid_signature",
  });
});

test("portal assertions, admin session tokens, and api keys are not staff assertions", () => {
  const portal = createClientPortalAssertion(
    { clientAccountId: "client-1", portalSessionEpoch: 1 },
    SECRET,
    NOW
  );
  assert.deepEqual(verifyStaffAssertion(portal, { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "malformed",
  });
  assert.deepEqual(verifyStaffAssertion("ac1.eyJ0eXAiOiJhZG1pbl9jb2MifQ.signature", { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "malformed",
  });
  assert.deepEqual(verifyStaffAssertion(OTHER_SECRET, { secret: SECRET, nowSec: NOW }), {
    ok: false,
    code: "malformed",
  });
  assert.notEqual(STAFF_ASSERTION_HEADER, "x-sa360-client-portal-assertion");
  assert.notEqual(STAFF_ASSERTION_HEADER, "x-sa360-admin-key");
  assert.equal(STAFF_ASSERTION_FAILURES.includes("invalid_signature"), true);
});

test("the staff assertion module stays free of database, route, and other credentials", () => {
  const source = readFileSync(new URL("./staff-assertion.ts", import.meta.url), "utf8");
  assert.match(source, new RegExp(`env\\[${STAFF_ASSERTION_SECRET_ENV}\\]|env\\[STAFF_ASSERTION_SECRET_ENV\\]`));
  assert.doesNotMatch(source, /from ["'](?!node:crypto)/);
  assert.doesNotMatch(source, /prisma|fastify|app\.(get|post)|delivery|fulfillment|correction|oauth|google/i);
  assert.doesNotMatch(source, /ADMIN_API_KEY|ADMIN_COC_SESSION_SECRET|SA360_ASSOCIATION_CORRECTION_SNAPSHOT_SECRET|SA360_ADMIN_KEY|NEXT_PUBLIC_/);
  assert.doesNotMatch(source, /process\.env\.SA360_STAFF_ASSERTION_SECRET/);
});
