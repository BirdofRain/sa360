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

test("both internal staff routes share one readiness gate", async () => {
  const token = await idToken();
  const session = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: SUB,
    nowSec: Math.floor(Date.now() / 1000),
    secret: SECRET,
  }).token;
  const routes = [
    {
      url: "/internal/staff/google/resolve",
      headers: { "x-sa360-staff-google-service": SERVICE },
      payload: { idToken: token, nonce: NONCE },
    },
    {
      url: "/internal/staff/session",
      headers: { "x-sa360-staff-google-service": SERVICE, "x-sa360-staff-session": session },
      payload: undefined,
    },
  ] as const;
  const withoutFlag = enabled();
  delete withoutFlag.SA360_STAFF_GOOGLE_SIGNIN_ENABLED;
  const withoutClientId = enabled();
  delete withoutClientId.SA360_STAFF_GOOGLE_CLIENT_ID;
  const withoutSessionSecret = enabled();
  delete withoutSessionSecret.SA360_STAFF_SESSION_SECRET;
  const withoutServiceSecret = enabled();
  delete withoutServiceSecret.SA360_STAFF_GOOGLE_SERVICE_SECRET;
  const unconfigured: Array<[string, NodeJS.ProcessEnv]> = [
    ["flag missing", withoutFlag],
    ["flag false", enabled({ SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "false" })],
    ["client id missing", withoutClientId],
    ["client id invalid", enabled({ SA360_STAFF_GOOGLE_CLIENT_ID: "not-a-google-client" })],
    ["session secret missing", withoutSessionSecret],
    ["session secret invalid", enabled({ SA360_STAFF_SESSION_SECRET: "short secret" })],
    ["service secret missing", withoutServiceSecret],
    ["service secret invalid", enabled({ SA360_STAFF_GOOGLE_SERVICE_SECRET: "short-service-secret" })],
    ["service secret reused as admin key", enabled({ ADMIN_API_KEY: SERVICE })],
    ["service secret reused as portal key", enabled({ CLIENT_PORTAL_API_KEY: SERVICE })],
    ["service secret reused as workspace key", enabled({ AGENT_WORKSPACE_API_KEY: SERVICE })],
    ["service secret reused as session secret", enabled({ SA360_STAFF_SESSION_SECRET: SERVICE, SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE })],
  ];

  for (const [name, env] of unconfigured) {
    for (const route of routes) {
      const { app, calls } = await appFor(bound(), env);
      const response = await app.inject({
        method: "POST",
        url: route.url,
        headers: {
          ...route.headers,
          ...("x-sa360-staff-session" in route.headers ? { "x-sa360-staff-session": "not-a-staff-session" } : {}),
        },
        payload: route.payload,
      });
      assert.equal(response.statusCode, 404, `${name} ${route.url}`);
      assert.deepEqual(calls, [], `${name} ${route.url}`);
    }
  }

  for (const headers of [
    { "x-sa360-admin-key": "shared-admin-key" },
    { "x-sa360-staff-google-service": "wrong-staff-service-secret-32-characters" },
  ]) {
    for (const route of routes) {
      const { app, calls } = await appFor(bound(), enabled());
      const response = await app.inject({
        method: "POST",
        url: route.url,
        headers: { ...headers, ...("x-sa360-staff-session" in route.headers ? { "x-sa360-staff-session": session } : {}) },
        payload: route.payload,
      });
      assert.equal(response.statusCode, 401, `${route.url} ${headers["x-sa360-staff-google-service"] ?? "missing"}`);
      assert.deepEqual(calls, [], route.url);
    }
  }

  const ready = await appFor(bound(), enabled());
  const resolved = await ready.app.inject({
    method: "POST",
    url: "/internal/staff/google/resolve",
    headers: serviceHeaders(),
    payload: { idToken: token, nonce: NONCE },
  });
  assert.equal(resolved.statusCode, 200);
  const live = await ready.app.inject({
    method: "POST",
    url: "/internal/staff/session",
    headers: serviceHeaders({ "x-sa360-staff-session": session }),
  });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(ready.calls, ["verify", `subject:${SUB}`, `id:${PRINCIPAL}`]);
  assert.equal(enabled().SA360_STAFF_GOOGLE_CLIENT_SECRET, undefined);
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

test("state consumption is authenticated, single use, and hidden while unconfigured", async () => {
  const replayId = "a".repeat(64);
  const seen = new Set<string>();
  let claims = 0;
  const claimReplay = async (id: string) => {
    claims += 1;
    if (seen.has(id)) return "reused" as const;
    seen.add(id);
    return "claimed" as const;
  };
  const calls: string[] = [];
  const first = Fastify();
  const second = Fastify();
  await first.register(staffGoogleRoutes, {
    env: enabled(),
    claimReplay,
    verifyIdToken: async () => {
      calls.push("verify");
      return { ok: false, code: "invalid_token" };
    },
    findByGoogleSubject: async () => {
      calls.push("lookup");
      return null;
    },
  });
  await second.register(staffGoogleRoutes, {
    env: enabled(),
    claimReplay,
    findById: async () => {
      calls.push("lookup");
      return null;
    },
  });

  const missing = await first.inject({
    method: "POST",
    url: "/internal/staff/google/state/consume",
    headers: { "x-sa360-admin-key": "shared-admin-key" },
    payload: { replayId, staffPrincipalId: PRINCIPAL },
  });
  assert.equal(missing.statusCode, 401);
  assert.equal(claims, 0);

  const claimed = await first.inject({
    method: "POST",
    url: "/internal/staff/google/state/consume",
    headers: serviceHeaders(),
    payload: { replayId, staffPrincipalId: PRINCIPAL, sub: SUB },
  });
  assert.equal(claimed.statusCode, 200);
  assert.deepEqual(claimed.json(), { ok: true });
  const replayed = await second.inject({
    method: "POST",
    url: "/internal/staff/google/state/consume",
    headers: serviceHeaders(),
    payload: { replayId },
  });
  assert.equal(replayed.statusCode, 401);
  assert.deepEqual(replayed.json(), { ok: false });
  assert.deepEqual(calls, []);

  const hidden = Fastify();
  await hidden.register(staffGoogleRoutes, {
    env: {},
    claimReplay: async () => {
      throw new Error("disabled consume must not reach redis");
    },
  });
  const disabled = await hidden.inject({
    method: "POST",
    url: "/internal/staff/google/state/consume",
    headers: serviceHeaders(),
    payload: { replayId },
  });
  assert.equal(disabled.statusCode, 404);

  const down = Fastify();
  await down.register(staffGoogleRoutes, { env: enabled(), claimReplay: async () => "unavailable" });
  const failed = await down.inject({
    method: "POST",
    url: "/internal/staff/google/state/consume",
    headers: serviceHeaders(),
    payload: { replayId: "b".repeat(64) },
  });
  assert.equal(failed.statusCode, 503);
});
