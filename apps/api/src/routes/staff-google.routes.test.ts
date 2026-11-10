import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

import { GOOGLE_ISSUER } from "@sa360/shared/staff-google-oidc";
import { STAFF_SESSION_TTL_SECONDS, signStaffSession } from "@sa360/shared/staff-google-session";
import type { ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { verifyStaffGoogleIdToken } from "../lib/staff-google-oidc.js";
import { staffGoogleRoutes } from "./staff-google.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const SECRET = "staff-session-secret-at-least-32-characters";
const SERVICE = "staff-google-service-secret-32-characters";
const PRINCIPAL = "c123456789012345678901234";
const SUB = "102938475610293847561";
const NONCE = "n".repeat(43);
const NOW = 1_800_000_000;

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
    SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
    SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
    SA360_STAFF_SESSION_SECRET: SECRET,
    SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
    ...extra,
  };
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-sa360-staff-google-service": SERVICE, ...extra };
}

function bound(overrides: Partial<ProvisionedStaffPrincipal> = {}): ProvisionedStaffPrincipal {
  return {
    id: PRINCIPAL,
    email: "person@example.com",
    status: "active",
    provider: "google",
    providerSubject: SUB,
    disabledAt: null,
    ...overrides,
  };
}

async function idToken(claims: Record<string, unknown> = {}) {
  return new SignJWT({ email: "person@example.com", email_verified: true, nonce: NONCE, azp: CLIENT_ID, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(GOOGLE_ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject(typeof claims.sub === "string" ? claims.sub : SUB)
    .setIssuedAt(NOW - 10)
    .setExpirationTime(NOW + 600)
    .sign(privateKey);
}

async function appFor(principal: ProvisionedStaffPrincipal | null, env: NodeJS.ProcessEnv) {
  const calls: string[] = [];
  const app = Fastify();
  await app.register(staffGoogleRoutes, {
    env,
    findByGoogleSubject: async (sub: string) => {
      calls.push(`subject:${sub}`);
      if (principal?.providerSubject !== sub) return null;
      return principal;
    },
    findById: async (id: string) => {
      calls.push(`id:${id}`);
      if (principal?.id !== id) return null;
      return principal;
    },
    verifyIdToken: (input: Parameters<typeof verifyStaffGoogleIdToken>[0]) => {
      calls.push("verify");
      return verifyStaffGoogleIdToken({ ...input, getKey, nowSec: NOW });
    },
  });
  return { app, calls };
}

test("resolve denies unknown, disabled, unbound, and unverified identities without creating a principal", async () => {
  const source = readFileSync(join(import.meta.dirname, "../lib/staff-google-directory.ts"), "utf8");
  assert.equal(source.includes("staffPermission"), false);
  assert.equal(source.includes(".create"), false);
  assert.equal(source.includes(".update"), false);
  assert.equal(source.includes(".delete"), false);
  assert.equal(source.includes("where: { email"), false);

  const missing = await appFor(null, enabled());
  const unknown = await missing.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: await idToken(), nonce: NONCE },
  });
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(unknown.json(), { ok: false });
  assert.deepEqual(missing.calls, ["verify", `subject:${SUB}`]);

  const disabled = await appFor(bound({ status: "disabled", disabledAt: new Date("2026-01-01T00:00:00Z") }), enabled());
  const disabledResponse = await disabled.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: await idToken(), nonce: NONCE },
  });
  assert.equal(disabledResponse.statusCode, 401);

  const unbound = await appFor(bound({ providerSubject: null }), enabled());
  const unboundResponse = await unbound.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: await idToken(), nonce: NONCE },
  });
  assert.equal(unboundResponse.statusCode, 401);
  assert.deepEqual(unbound.calls, ["verify", `subject:${SUB}`]);

  const unverified = await appFor(bound(), enabled());
  const unverifiedResponse = await unverified.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: await idToken({ email_verified: false }), nonce: NONCE },
  });
  assert.equal(unverifiedResponse.statusCode, 401);
  assert.deepEqual(unverified.calls, ["verify"]);
});

test("an admin api key is not a staff identity", async () => {
  const { app, calls } = await appFor(bound(), enabled());
  const response = await app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: { "x-sa360-admin-key": "shared-admin-key" },
    payload: { sub: SUB, email: "person@example.com" },
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false });
  assert.deepEqual(calls, []);
});

test("a verified bound identity resolves and a staff session stays live only while that principal is active", async () => {
  const { app } = await appFor(bound(), enabled());
  const resolved = await app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: await idToken(), nonce: NONCE },
  });
  assert.equal(resolved.statusCode, 200);
  assert.deepEqual(Object.keys(resolved.json()).sort(), ["googleSub", "ok", "staffPrincipalId"]);
  assert.equal(resolved.json().staffPrincipalId, PRINCIPAL);

  const issuedAt = Math.floor(Date.now() / 1000);
  const session = signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: issuedAt, secret: SECRET });
  const live = await app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: serviceHeaders({ "x-sa360-staff-session": session.token }),
  });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { ok: true, staffPrincipalId: PRINCIPAL });

  const stale = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: SUB,
    nowSec: issuedAt - STAFF_SESSION_TTL_SECONDS - 5,
    secret: SECRET,
  });
  const expired = await app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: serviceHeaders({ "x-sa360-staff-session": stale.token }),
  });
  assert.equal(expired.statusCode, 401);

  const adminCookie = await app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: serviceHeaders({
      "x-sa360-staff-session": "ac1.eyJ0eXAiOiJhZG1pbl9jb2MifQ.signature",
      "x-sa360-admin-key": "shared-admin-key",
    }),
  });
  assert.equal(adminCookie.statusCode, 401);
});

test("the feature flag and missing secrets fail closed", async () => {
  const off = await appFor(bound(), {});
  const hidden = await off.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: { "x-sa360-staff-google-service": SERVICE },
    payload: { idToken: await idToken(), nonce: NONCE },
  });
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(off.calls, []);

  const noSecret = await appFor(bound(), { SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true", SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID });
  const session = signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: NOW, secret: SECRET });
  const missingSecret = await noSecret.app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: { "x-sa360-staff-session": session.token },
  });
  assert.equal(missingSecret.statusCode, 404);
  assert.deepEqual(noSecret.calls, []);
});

test("a live session whose stored subject differs is denied", async () => {
  const app = Fastify();
  await app.register(staffGoogleRoutes, {
    env: enabled(),
    findById: async (_id: string) => bound({ providerSubject: "99999999999999999999" }),
  });
  const session = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: SUB,
    nowSec: Math.floor(Date.now() / 1000),
    secret: SECRET,
  });
  const response = await app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: serviceHeaders({ "x-sa360-staff-session": session.token }),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false });
});

test("a disabled principal fails the live session check", async () => {
  const { app } = await appFor(bound({ status: "disabled", disabledAt: new Date("2026-01-01T00:00:00Z") }), enabled());
  const session = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: SUB,
    nowSec: Math.floor(Date.now() / 1000),
    secret: SECRET,
  });
  const response = await app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: serviceHeaders({ "x-sa360-staff-session": session.token }),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { ok: false });
});

test("service authentication is required and does not identify a person", async () => {
  const { app, calls } = await appFor(bound(), enabled());
  const token = await idToken();
  const missing = await app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: {
      "x-sa360-admin-key": "shared-admin-key",
      "x-sa360-client-portal-key": "portal-secret",
      "x-sa360-workspace-key": "workspace-secret",
      "x-sa360-operator": "operator-label",
    },
    payload: { idToken: token, nonce: NONCE },
  });
  assert.equal(missing.statusCode, 401);
  const invalid = await app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: { "x-sa360-staff-google-service": "wrong-staff-service-secret-32-characters" },
    payload: { idToken: token, nonce: NONCE },
  });
  assert.equal(invalid.statusCode, 401);
  const person = await app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { sub: SUB, email: "person@example.com" },
  });
  assert.equal(person.statusCode, 401);
  const sessionWithoutService = await app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: { "x-sa360-client-portal-key": "portal-secret", "x-sa360-workspace-key": "workspace-secret" },
  });
  assert.equal(sessionWithoutService.statusCode, 401);
  assert.deepEqual(calls, []);
  assert.equal(JSON.stringify(person.json()).includes(SERVICE), false);

  const forged = await app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: "forged.identity.token", nonce: NONCE },
  });
  assert.equal(forged.statusCode, 401);
  assert.deepEqual(calls, ["verify"]);

  const copied = await appFor(bound(), enabled({ ADMIN_API_KEY: SERVICE }));
  const collapsed = await copied.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: token, nonce: NONCE },
  });
  assert.equal(collapsed.statusCode, 404);
  assert.deepEqual(copied.calls, []);
});
