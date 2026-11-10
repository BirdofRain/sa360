import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

import { GOOGLE_ISSUER } from "@sa360/shared/staff-google-oidc";
import { STAFF_ENROLLMENT_ISSUER_HEADER } from "@sa360/shared/staff-enrollment";
import { STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";

import { verifyStaffGoogleIdToken } from "../lib/staff-google-oidc.js";
import { staffEnrollmentRoutes, type StaffEnrollmentRouteDeps } from "./staff-enrollment.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const SERVICE = "staff-google-service-secret-32-characters";
const ISSUER = "staff-enrollment-issuer-secret-32-chars";
const PRINCIPAL = "c123456789012345678901234";
const OTHER = "c000000000000000000000000";
const SUB = "102938475610293847561";
const NONCE = "n".repeat(43);
const SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

let getKey: JWTVerifyGetKey;
let privateKey: CryptoKey;

test.before(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  jwk.alg = "RS256";
  jwk.use = "sig";
  getKey = createLocalJWKSet({ keys: [jwk] });
});

function enabled(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SA360_STAFF_ENROLLMENT_ENABLED: "true",
    SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
    SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
    SA360_STAFF_ENROLLMENT_ISSUER_SECRET: ISSUER,
    ...extra,
  };
}

function token(claims: Record<string, unknown> = {}, audience = CLIENT_ID, issuer = GOOGLE_ISSUER) {
  const issued = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "ada.staff@example.com", email_verified: true, nonce: NONCE, azp: audience, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(typeof claims.sub === "string" ? claims.sub : SUB)
    .setIssuedAt(issued)
    .setExpirationTime(issued + 300)
    .sign(privateKey);
}

async function appFor(env: NodeJS.ProcessEnv, deps: Partial<StaffEnrollmentRouteDeps> = {}) {
  const calls: string[] = [];
  const app = Fastify();
  await app.register(staffEnrollmentRoutes, {
    env,
    verifyIdToken: (input: { idToken: string; audience: string; nonce: string }) => verifyStaffGoogleIdToken({ ...input, getKey }),
    provision: async (input: { email: string; displayName?: string | null }) => {
      calls.push(`provision:${input.email}`);
      assert.equal("providerSubject" in input, false);
      return { ok: true, staffPrincipalId: PRINCIPAL };
    },
    issue: async (input: { staffPrincipalId: string }) => {
      calls.push(`issue:${input.staffPrincipalId}`);
      return {
        ok: true,
        staffPrincipalId: input.staffPrincipalId,
        grantId: OTHER,
        enrollmentSecret: SECRET,
        expiresAt: new Date("2026-11-10T18:00:00.000Z"),
      };
    },
    cancel: async () => ({ ok: true }),
    disable: async (input: { staffPrincipalId: string }) => {
      calls.push(`disable:${input.staffPrincipalId}`);
      return { ok: true, staffPrincipalId: input.staffPrincipalId };
    },
    status: async () => ({
      ok: true,
      staffPrincipalId: PRINCIPAL,
      email: "ada.staff@example.com",
      status: "active",
      providerSubject: null,
      pendingGrantId: null,
    }),
    preview: async () => ({ ok: true }),
    bind: async (input: { enrollmentSecret: string; identity: { sub: string; email: string } }) => {
      calls.push(`bind:${input.enrollmentSecret}:${input.identity.sub}:${input.identity.email}`);
      assert.equal("staffPrincipalId" in input, false);
      return { ok: true, staffPrincipalId: PRINCIPAL };
    },
    claimReplay: async () => "claimed",
    ...deps,
  });
  return { app, calls };
}

test("enrollment stays hidden until its own flag and dedicated issuer secret exist", async () => {
  const hidden = await appFor({});
  for (const url of [
    "/internal/staff/enrollment/provision",
    "/internal/staff/enrollment/issue",
    "/internal/staff/enrollment/cancel",
    "/internal/staff/enrollment/disable",
    "/internal/staff/enrollment/status",
    "/internal/staff/enrollment/preview",
    "/internal/staff/enrollment/complete",
    "/internal/staff/enrollment/state/consume",
  ]) {
    const response = await hidden.app.inject({
      method: "POST",
      url,
      headers: { [STAFF_ENROLLMENT_ISSUER_HEADER]: ISSUER, [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { staffPrincipalId: PRINCIPAL, email: "ada.staff@example.com", enrollmentSecret: SECRET, replayId: "a".repeat(64) },
    });
    assert.equal(response.statusCode, 404, url);
  }
  assert.deepEqual(hidden.calls, []);

  const noIssuer = await appFor(enabled({ SA360_STAFF_ENROLLMENT_ISSUER_SECRET: undefined }));
  const issue = await noIssuer.app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/issue",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { staffPrincipalId: PRINCIPAL },
  });
  assert.equal(issue.statusCode, 404);
  assert.deepEqual(noIssuer.calls, []);
});

test("the shared admin key and the service credential cannot issue an invitation", async () => {
  const { app, calls } = await appFor(enabled());
  const adminKey = await app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/issue",
    headers: { "x-sa360-admin-key": ISSUER },
    payload: { staffPrincipalId: PRINCIPAL },
  });
  const service = await app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/issue",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { staffPrincipalId: PRINCIPAL },
  });
  assert.equal(adminKey.statusCode, 401);
  assert.equal(service.statusCode, 401);
  assert.deepEqual(calls, []);
});

test("a verified Google token enrolls only the invitation, not a caller-selected principal", async () => {
  const { app, calls } = await appFor(enabled());
  const idToken = await token();
  const response = await app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/complete",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { enrollmentSecret: SECRET, idToken, nonce: NONCE, staffPrincipalId: OTHER, email: "ada.staff@example.com" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, staffPrincipalId: PRINCIPAL });
  assert.deepEqual(calls, [`bind:${SECRET}:${SUB}:ada.staff@example.com`]);

  const emailOnly = await app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/complete",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { idToken, nonce: NONCE, email: "ada.staff@example.com" },
  });
  assert.equal(emailOnly.statusCode, 401);
  assert.equal(calls.length, 1);
});

test("forged, mis-issued, and unverified Google tokens do not bind", async () => {
  const { app, calls } = await appFor(enabled());
  const cases = [
    await token({ email_verified: false }),
    await token({}, CLIENT_ID, "https://evil.example"),
    await token({}, "other-client.apps.googleusercontent.com"),
    "not-a-jwt",
  ];
  for (const idToken of cases) {
    const response = await app.inject({
      method: "POST",
      url: "/internal/staff/enrollment/complete",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { enrollmentSecret: SECRET, idToken, nonce: NONCE },
    });
    assert.equal(response.statusCode, 401);
  }
  const wrongNonce = await app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/complete",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { enrollmentSecret: SECRET, idToken: await token(), nonce: "m".repeat(43) },
  });
  assert.equal(wrongNonce.statusCode, 401);
  assert.deepEqual(calls, []);
});

test("a database or redis failure does not report success", async () => {
  const database = await appFor(enabled(), { bind: async () => ({ ok: false, code: "unavailable" }) });
  const failed = await database.app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/complete",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { enrollmentSecret: SECRET, idToken: await token(), nonce: NONCE },
  });
  assert.equal(failed.statusCode, 503);

  const redis = await appFor(enabled(), { claimReplay: async () => "unavailable" });
  const replay = await redis.app.inject({
    method: "POST",
    url: "/internal/staff/enrollment/state/consume",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    payload: { replayId: "ab".repeat(32) },
  });
  assert.equal(replay.statusCode, 503);
});
