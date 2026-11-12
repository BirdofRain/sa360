/**
 * Isolated rehearsal of one synthetic staff account.
 * The Google ID token is signed by a local test key. It is not a live Google login.
 * The database must be the local sa360_test database. Redis must be a local test Redis.
 * Rows stay in that local database because principals cannot be deleted.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

import { GOOGLE_ISSUER } from "@sa360/shared/staff-google-oidc";
import { signStaffSession, STAFF_SESSION_HEADER, staffSessionRegistryKey } from "@sa360/shared/staff-google-session";
import { STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";
import { STAFF_GOOGLE_STATE_REPLAY_PREFIX, staffGoogleStateReplayId } from "@sa360/shared/staff-google-state";

import { assertSafeTestDatabaseUrl, parseSafeTestDatabaseUrlIdentity } from "./safe-test-database-url.js";
import { verifyStaffGoogleIdToken } from "./staff-google-oidc.js";
import {
  bindStaffEnrollment,
  disableStaffPrincipal,
  issueStaffEnrollment,
  provisionUnboundStaffPrincipal,
} from "./staff-enrollment.js";
import { claimStaffGoogleStateReplay } from "./staff-google-state-replay.js";
import { createRedisStaffSessionRegistry, type StaffSessionRegistry } from "./staff-session-registry.js";
import { staffGoogleRoutes } from "../routes/staff-google.js";
import { staffTeamRoutes } from "../routes/staff-team.js";
import { readGrantedStaffPermissions } from "./staff-team-management.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const SESSION_SECRET = "staff-session-secret-at-least-32-characters";
const SERVICE = "staff-google-service-secret-32-characters";
const LOCAL_REDIS_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_REDIS_FALLBACK_URL = "redis://127.0.0.1:6379/15";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

function readSafeTestRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.SA360_TEST_REDIS_URL?.trim();
  const candidate = configured || TEST_REDIS_FALLBACK_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "redis:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_REDIS_HOSTS.has(host)) return null;
  return candidate;
}

describe("synthetic first staff login rehearsal", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let privateKey: CryptoKey;
  let getKey: JWTVerifyGetKey;
  const redisClients: Redis[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const identity = parseSafeTestDatabaseUrlIdentity(url);
    assert.equal(identity.host === "127.0.0.1" || identity.host === "localhost" || identity.host === "::1", true);
    assert.equal(/test/i.test(identity.database), true);
    db = new PrismaClient({ datasources: { db: { url } } });
    const keys = await generateKeyPair("RS256", { extractable: true });
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = "rehearsal";
    jwk.alg = "RS256";
    jwk.use = "sig";
    getKey = createLocalJWKSet({ keys: [jwk] });
  });

  after(async () => {
    for (const client of redisClients) client.disconnect();
    if (db) await db.$disconnect();
  });

  it("enrolls, signs in, revokes, and fails closed on a local test database", async (t) => {
    const redisUrl = readSafeTestRedisUrl();
    if (!redisUrl) {
      t.skip("SA360_TEST_REDIS_URL is not a local test Redis; the rehearsal did not run");
      return;
    }
    const options = {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    };
    const probe = new Redis(redisUrl, options);
    probe.on("error", () => undefined);
    try {
      await probe.connect();
      await probe.ping();
    } catch {
      t.skip("safe local test Redis unavailable; the rehearsal did not run");
      return;
    } finally {
      probe.disconnect();
    }

    const mailbox = `rehearsal.${randomBytes(4).toString("hex")}@example.com`;
    const subject = `sub${randomBytes(8).toString("hex")}`;
    const nonce = "n".repeat(43);
    const created = await provisionUnboundStaffPrincipal({ email: mailbox, displayName: "Synthetic Staff" }, db);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.match(created.staffPrincipalId, /^c[a-z0-9]{24}$/);
    const issued = await issueStaffEnrollment({ staffPrincipalId: created.staffPrincipalId }, db);
    assert.equal(issued.ok, true);
    if (!issued.ok) return;

    const idToken = await new SignJWT({
      email: mailbox,
      email_verified: true,
      nonce,
      azp: CLIENT_ID,
    })
      .setProtectedHeader({ alg: "RS256", kid: "rehearsal" })
      .setIssuer(GOOGLE_ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const verified = await verifyStaffGoogleIdToken({ idToken, audience: CLIENT_ID, nonce, getKey });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    const bound = await bindStaffEnrollment(
      { enrollmentSecret: issued.enrollmentSecret, identity: verified.identity },
      db
    );
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(bound.staffPrincipalId, created.staffPrincipalId);
    const principal = await db.staffPrincipal.findUniqueOrThrow({ where: { id: created.staffPrincipalId } });
    assert.equal(principal.providerSubject, subject);
    assert.equal(principal.status, "active");
    const reused = await bindStaffEnrollment(
      { enrollmentSecret: issued.enrollmentSecret, identity: verified.identity },
      db
    );
    assert.deepEqual(reused, { ok: false, code: "reused" });
    assert.equal(await db.staffPermission.count({ where: { staffPrincipalId: principal.id } }), 0);
    const grant = await db.staffEnrollmentGrant.findUniqueOrThrow({ where: { id: issued.grantId } });
    assert.equal(grant.status, "consumed");
    const consumed = await db.staffEnrollmentEvent.findFirstOrThrow({
      where: { grantId: issued.grantId, kind: "consumed" },
    });
    assert.equal(consumed.googleSub, subject);

    const databaseDown = await bindStaffEnrollment(
      { enrollmentSecret: issued.enrollmentSecret, identity: verified.identity },
      { $transaction: async () => { throw new Error("database unavailable"); } } as unknown as PrismaClient
    );
    assert.deepEqual(databaseDown, { ok: false, code: "unavailable" });

    const firstRedis = new Redis(redisUrl, options);
    const secondRedis = new Redis(redisUrl, options);
    firstRedis.on("error", () => undefined);
    secondRedis.on("error", () => undefined);
    redisClients.push(firstRedis, secondRedis);
    await firstRedis.connect();
    await secondRedis.connect();
    const replayId = staffGoogleStateReplayId(`rehearsal-state-${randomBytes(8).toString("hex")}`);
    assert.equal(await claimStaffGoogleStateReplay(replayId, firstRedis), "claimed");
    assert.equal(await claimStaffGoogleStateReplay(replayId, secondRedis), "reused");
    await firstRedis.del(`${STAFF_GOOGLE_STATE_REPLAY_PREFIX}${replayId}`);

    const loginEnv = {
      SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
      SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
      SA360_STAFF_SESSION_SECRET: SESSION_SECRET,
      SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
    };
    const enrollmentOnly = await Fastify();
    await enrollmentOnly.register(staffGoogleRoutes, {
      env: { SA360_STAFF_ENROLLMENT_ENABLED: "true", SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID },
      verifyIdToken: async () => verified,
    });
    const loginOff = await enrollmentOnly.inject({
      method: "POST",
      url: "/internal/staff/google/resolve",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { idToken, nonce },
    });
    assert.equal(loginOff.statusCode, 404);
    await enrollmentOnly.close();

    const finder = {
      findByGoogleSubject: async (sub: string) => {
        const row = await db.staffPrincipal.findUnique({
          where: { provider_providerSubject: { provider: "google", providerSubject: sub } },
        });
        return row && row.provider === "google"
          ? { ...row, status: row.status === "active" ? "active" as const : "disabled" as const }
          : null;
      },
      findById: async (id: string) => {
        const row = await db.staffPrincipal.findUnique({ where: { id } });
        return row && row.provider === "google"
          ? { ...row, status: row.status === "active" ? "active" as const : "disabled" as const }
          : null;
      },
    };
    const firstRegistry = createRedisStaffSessionRegistry(firstRedis);
    const secondRegistry = createRedisStaffSessionRegistry(secondRedis);
    const firstApp = await staffApp(loginEnv, firstRegistry, finder, getKey);
    const secondApp = await staffApp(loginEnv, secondRegistry, finder, getKey);
    await firstApp.register(staffTeamRoutes, {
      env: loginEnv,
      sessionRegistry: firstRegistry,
      findById: finder.findById,
      permissions: (input: { staffPrincipalId: string }) => readGrantedStaffPermissions(input, db),
    });
    await secondApp.register(staffTeamRoutes, {
      env: loginEnv,
      sessionRegistry: secondRegistry,
      findById: finder.findById,
      permissions: (input: { staffPrincipalId: string }) => readGrantedStaffPermissions(input, db),
    });
    const resolved = await firstApp.inject({
      method: "POST",
      url: "/internal/staff/google/resolve",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { idToken, nonce },
    });
    assert.equal(resolved.statusCode, 200);
    assert.deepEqual(resolved.json(), { ok: true, staffPrincipalId: principal.id, googleSub: subject });

    const session = signStaffSession({
      staffPrincipalId: principal.id,
      googleSub: subject,
      secret: SESSION_SECRET,
    });
    const registered = await firstApp.inject({
      method: "POST",
      url: "/internal/staff/session/register",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { token: session.token },
    });
    assert.equal(registered.statusCode, 200);
    const seenElsewhere = await secondApp.inject({
      method: "POST",
      url: "/internal/staff/session",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: session.token },
    });
    assert.equal(seenElsewhere.statusCode, 200);
    const limited = await firstApp.inject({
      method: "POST",
      url: "/internal/staff/session/capabilities",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: session.token },
    });
    assert.equal(limited.statusCode, 200);
    assert.deepEqual(limited.json(), {
      ok: true,
      access: "limited",
      permissions: [],
      staffPrincipalId: principal.id,
    });

    const redisDown = createRedisStaffSessionRegistry({
      eval: async () => { throw new Error("redis unavailable"); },
      get: async () => { throw new Error("redis unavailable"); },
    });
    const downApp = await staffApp(loginEnv, redisDown, finder, getKey);
    const redisFailure = await downApp.inject({
      method: "POST",
      url: "/internal/staff/session",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: session.token },
    });
    assert.equal(redisFailure.statusCode, 503);
    await downApp.close();

    const databaseFailure = await staffApp(loginEnv, secondRegistry, {
      findByGoogleSubject: async () => { throw new Error("database unavailable"); },
      findById: async () => { throw new Error("database unavailable"); },
    }, getKey);
    const databaseDenied = await databaseFailure.inject({
      method: "POST",
      url: "/internal/staff/google/resolve",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { idToken, nonce },
    });
    assert.equal(databaseDenied.statusCode >= 500, true);
    await databaseFailure.close();

    const revoked = await firstApp.inject({
      method: "POST",
      url: "/internal/staff/session/revoke",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: session.token },
    });
    assert.equal(revoked.statusCode, 200);
    const copied = await secondApp.inject({
      method: "POST",
      url: "/internal/staff/session",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: session.token },
    });
    assert.equal(copied.statusCode, 401);
    const revokedCapabilities = await secondApp.inject({
      method: "POST",
      url: "/internal/staff/session/capabilities",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: session.token },
    });
    assert.equal(revokedCapabilities.statusCode, 401);
    assert.deepEqual(revokedCapabilities.json(), { ok: false });

    const replacement = signStaffSession({
      staffPrincipalId: principal.id,
      googleSub: subject,
      secret: SESSION_SECRET,
    });
    assert.equal(
      (await firstApp.inject({
        method: "POST",
        url: "/internal/staff/session/register",
        headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
        payload: { token: replacement.token },
      })).statusCode,
      200
    );
    assert.equal(
      (await disableStaffPrincipal({ staffPrincipalId: principal.id }, db)).ok,
      true
    );
    const disabledSession = await secondApp.inject({
      method: "POST",
      url: "/internal/staff/session",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: replacement.token },
    });
    assert.equal(disabledSession.statusCode, 401);
    const disabledCapabilities = await secondApp.inject({
      method: "POST",
      url: "/internal/staff/session/capabilities",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: replacement.token },
    });
    assert.equal(disabledCapabilities.statusCode, 401);
    assert.deepEqual(disabledCapabilities.json(), { ok: false });
    const disabledLogin = await firstApp.inject({
      method: "POST",
      url: "/internal/staff/google/resolve",
      headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
      payload: { idToken, nonce },
    });
    assert.equal(disabledLogin.statusCode, 401);
    const stillBound = await db.staffPrincipal.findUniqueOrThrow({ where: { id: principal.id } });
    assert.equal(stillBound.providerSubject, subject);
    assert.equal(stillBound.status, "disabled");
    assert.equal(await db.staffEnrollmentEvent.count({ where: { grantId: issued.grantId } }) > 0, true);

    const loginSource = readFileSync(new URL("../../../admin-coc/src/app/actions/login.ts", import.meta.url), "utf8");
    assert.equal(loginSource.includes("sa360_staff_session"), false);
    assert.equal(loginSource.includes("staff-enrollment"), false);
    assert.equal(loginSource.includes("ADMIN_COC_SESSION_COOKIE"), true);

    await firstRedis.del(staffSessionRegistryKey(session.claims.jti), staffSessionRegistryKey(replacement.claims.jti));
    await firstApp.close();
    await secondApp.close();
  });
});

async function staffApp(
  env: NodeJS.ProcessEnv,
  sessionRegistry: StaffSessionRegistry,
  finder: {
    findByGoogleSubject: (sub: string) => Promise<{ id: string; email: string; status: "active" | "disabled"; provider: "google"; providerSubject: string | null; disabledAt: Date | null } | null>;
    findById: (id: string) => Promise<{ id: string; email: string; status: "active" | "disabled"; provider: "google"; providerSubject: string | null; disabledAt: Date | null } | null>;
  },
  getKey: JWTVerifyGetKey
) {
  const app = Fastify();
  await app.register(staffGoogleRoutes, {
    env,
    sessionRegistry,
    findByGoogleSubject: finder.findByGoogleSubject,
    findById: finder.findById,
    verifyIdToken: (input: { idToken: string; audience: string; nonce: string; nowSec?: number }) =>
      verifyStaffGoogleIdToken({ ...input, getKey }),
  });
  return app;
}
