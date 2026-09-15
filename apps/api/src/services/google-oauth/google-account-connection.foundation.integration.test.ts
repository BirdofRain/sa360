/**
 * Local sa360_test-only Google account connection foundation matrix.
 * No Google HTTP. No live OAuth. Isolated GOOGLE_TOKEN_ENCRYPTION_KEY only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { decryptGoogleToken, encryptGoogleToken } from "../../lib/google-token-encryption.js";
import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { presentGoogleAccountConnection } from "./google-connection.present.js";
import {
  compareAndSetGoogleConnectionTokenRefresh,
  disconnectGoogleConnection,
  getGoogleAccountConnectionByClientAccountId,
  getGoogleAccountConnectionForTenant,
  getGoogleConnectionSecretsForTenant,
  markGoogleConnectionReconnectRequired,
  upsertGoogleAccountConnectionForClient,
} from "./google-connection.service.js";
import {
  consumeGoogleOAuthPendingAuthForClient,
  createGoogleOAuthPendingAuthForClient,
} from "./google-oauth-pending-auth.service.js";
import { createGoogleAccountConnection } from "../../repositories/google-account-connection.repository.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const GOOGLE_TEST_KEY = "test-google-encryption-key-for-unit-tests-only";
const GHL_TEST_KEY = "test-encryption-key-for-unit-tests-only";
const ACCESS = "ya29.google-access-token-phase1a";
const REFRESH = "1//google-refresh-token-phase1a";
const ACCESS_2 = "ya29.google-access-token-rotated";
const REFRESH_2 = "1//google-refresh-token-rotated";

describe("Google account auth data foundation (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const tenantA = `gacc_a_${suffix}`;
  const tenantB = `gacc_b_${suffix}`;
  const previousEnv: Record<string, string | undefined> = {};

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });

    for (const key of ["GOOGLE_TOKEN_ENCRYPTION_KEY", "GHL_TOKEN_ENCRYPTION_KEY"]) {
      previousEnv[key] = process.env[key];
    }
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = GOOGLE_TEST_KEY;
    process.env.GHL_TOKEN_ENCRYPTION_KEY = GHL_TEST_KEY;

    await cleanup();
    await db.clientAccount.createMany({
      data: [
        {
          clientAccountId: tenantA,
          clientDisplayName: "Google Foundation Tenant A",
          status: "active",
        },
        {
          clientAccountId: tenantB,
          clientDisplayName: "Google Foundation Tenant B",
          status: "active",
        },
      ],
    });
  });

  after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup(): Promise<void> {
    await db.googleOAuthPendingAuth.deleteMany({
      where: { clientAccountId: { in: [tenantA, tenantB] } },
    });
    await db.googleAccountConnection.deleteMany({
      where: { clientAccountId: { in: [tenantA, tenantB] } },
    });
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [tenantA, tenantB] } },
    });
  }

  it("F/G. one active connection per ClientAccount; Google identity cannot cross tenants", async () => {
    const created = await upsertGoogleAccountConnectionForClient(
      {
        clientAccountId: tenantA,
        googleUserId: "google-sub-shared",
        googleEmail: "sam@example.com",
        googleDisplayName: "Sam",
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      },
      db
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(created.connection.clientAccountId, tenantA);
    assert.equal(created.connection.status, "connected");
    assert.equal(
      payloadContainsPlaintextSecret(created.connection, [ACCESS, REFRESH]),
      false
    );

    await assert.rejects(
      () =>
        createGoogleAccountConnection(
          {
            clientAccount: { connect: { clientAccountId: tenantA } },
            googleUserId: "google-sub-other",
            status: "connected",
            accessTokenEncrypted: encryptGoogleToken("other-access"),
            refreshTokenEncrypted: encryptGoogleToken("other-refresh"),
            tokenExpiresAt: new Date(),
          },
          db
        ),
      (err: unknown) =>
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2002" || err.code === "P2014")
    );

    const cross = await upsertGoogleAccountConnectionForClient(
      {
        clientAccountId: tenantB,
        googleUserId: "google-sub-shared",
        googleEmail: "sam@example.com",
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(cross.ok, false);
    if (!cross.ok) {
      assert.equal(cross.reason, "google_identity_owned_by_other_tenant");
    }

    const byIdWrongTenant = await getGoogleAccountConnectionForTenant(
      { id: created.connection.id, clientAccountId: tenantB },
      db
    );
    assert.equal(byIdWrongTenant, null);

    const secretsWrongTenant = await getGoogleConnectionSecretsForTenant(
      { id: created.connection.id, clientAccountId: tenantB },
      db
    );
    assert.equal(secretsWrongTenant, null);
  });

  it("H/I. stale tokenVersion CAS fails; current version succeeds and increments", async () => {
    const row = await getGoogleAccountConnectionByClientAccountId(tenantA, db);
    assert.ok(row);
    const version = row.tokenVersion;

    const stale = await compareAndSetGoogleConnectionTokenRefresh(
      {
        id: row.id,
        clientAccountId: tenantA,
        expectedTokenVersion: version - 1,
        accessToken: ACCESS_2,
        refreshToken: REFRESH_2,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.reason, "stale_version");

    const afterStale = await getGoogleAccountConnectionByClientAccountId(tenantA, db);
    assert.equal(afterStale?.tokenVersion, version);
    const secretsUnchanged = await getGoogleConnectionSecretsForTenant(
      { id: row.id, clientAccountId: tenantA },
      db
    );
    assert.ok(secretsUnchanged?.accessTokenEncrypted);
    assert.equal(decryptGoogleToken(secretsUnchanged.accessTokenEncrypted!), ACCESS);

    const fresh = await compareAndSetGoogleConnectionTokenRefresh(
      {
        id: row.id,
        clientAccountId: tenantA,
        expectedTokenVersion: version,
        accessToken: ACCESS_2,
        refreshToken: REFRESH_2,
        tokenExpiresAt: new Date(Date.now() + 7200_000),
      },
      db
    );
    assert.equal(fresh.ok, true);
    if (!fresh.ok) return;
    assert.equal(fresh.tokenVersion, version + 1);

    const secrets = await getGoogleConnectionSecretsForTenant(
      { id: row.id, clientAccountId: tenantA },
      db
    );
    assert.ok(secrets?.accessTokenEncrypted);
    assert.equal(decryptGoogleToken(secrets.accessTokenEncrypted!), ACCESS_2);
    assert.equal(decryptGoogleToken(secrets.refreshTokenEncrypted!), REFRESH_2);
    assert.equal(
      payloadContainsPlaintextSecret(fresh.connection, [ACCESS_2, REFRESH_2]),
      false
    );
    assert.equal((fresh.connection as Record<string, unknown>).accessTokenEncrypted, undefined);
  });

  it("J/K/L/M. pending auth is tenant-bound, expires, and can be consumed only once", async () => {
    const created = await createGoogleOAuthPendingAuthForClient(
      { clientAccountId: tenantA, returnTo: "/portal/account" },
      db
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.pending.clientAccountId, tenantA);
    assert.equal((created.pending as Record<string, unknown>).pkceVerifierEncrypted, undefined);
    assert.equal((created.pending as Record<string, unknown>).stateHash, undefined);

    const otherTenant = await consumeGoogleOAuthPendingAuthForClient(
      { rawState: created.state, clientAccountId: tenantB },
      db
    );
    assert.equal(otherTenant.ok, false);
    if (!otherTenant.ok) assert.equal(otherTenant.reason, "tenant_mismatch");

    const expired = await createGoogleOAuthPendingAuthForClient(
      {
        clientAccountId: tenantA,
        returnTo: "/portal/orders",
        expiresAt: new Date(Date.now() - 1000),
      },
      db
    );
    assert.equal(expired.ok, true);
    if (!expired.ok) return;
    const expiredConsume = await consumeGoogleOAuthPendingAuthForClient(
      { rawState: expired.state, clientAccountId: tenantA },
      db
    );
    assert.equal(expiredConsume.ok, false);
    if (!expiredConsume.ok) assert.equal(expiredConsume.reason, "expired");

    const first = await consumeGoogleOAuthPendingAuthForClient(
      { rawState: created.state, clientAccountId: tenantA },
      db
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.returnTo, "/portal/account");
    assert.ok(first.pkceVerifier.length > 0);

    const replay = await consumeGoogleOAuthPendingAuthForClient(
      { rawState: created.state, clientAccountId: tenantA },
      db
    );
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "already_consumed");
  });

  it("N. create pending auth rejects malicious returnTo", async () => {
    const bad = await createGoogleOAuthPendingAuthForClient(
      { clientAccountId: tenantA, returnTo: "https://evil.example" },
      db
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.reason, "invalid_return_to");
  });

  it("O. disconnect wipes token ciphertext and preserves audit identity", async () => {
    const row = await getGoogleAccountConnectionByClientAccountId(tenantA, db);
    assert.ok(row);
    const beforeVersion = row.tokenVersion;

    const wiped = await disconnectGoogleConnection(
      { id: row.id, clientAccountId: tenantA },
      db
    );
    assert.equal("notFound" in wiped, false);
    if ("notFound" in wiped) return;
    assert.equal(wiped.connection.status, "disconnected");
    assert.ok(wiped.connection.disconnectedAt);
    assert.equal(wiped.connection.googleEmail, "sam@example.com");
    assert.equal(wiped.connection.googleUserId, "google-sub-shared");
    assert.equal(wiped.connection.tokenVersion, beforeVersion + 1);
    assert.equal((wiped.connection as Record<string, unknown>).accessTokenEncrypted, undefined);

    const secrets = await getGoogleConnectionSecretsForTenant(
      { id: row.id, clientAccountId: tenantA },
      db
    );
    assert.equal(secrets?.accessTokenEncrypted, null);
    assert.equal(secrets?.refreshTokenEncrypted, null);

    const casAfterWipe = await compareAndSetGoogleConnectionTokenRefresh(
      {
        id: row.id,
        clientAccountId: tenantA,
        expectedTokenVersion: wiped.connection.tokenVersion,
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(casAfterWipe.ok, false);
    if (!casAfterWipe.ok) assert.equal(casAfterWipe.reason, "disconnected");

    const reconnectOther = await upsertGoogleAccountConnectionForClient(
      {
        clientAccountId: tenantB,
        googleUserId: "google-sub-shared",
        googleEmail: "sam@example.com",
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(reconnectOther.ok, true);
    if (!reconnectOther.ok) return;

    const marked = await markGoogleConnectionReconnectRequired(
      { id: reconnectOther.connection.id, clientAccountId: tenantB },
      db
    );
    assert.equal("notFound" in marked, false);
    if ("notFound" in marked) return;
    assert.equal(marked.connection.status, "reconnect_required");
  });

  it("cross-tenant update/disconnect/CAS fail closed; reconnect cannot steal an active identity", async () => {
    const ownedB = await getGoogleAccountConnectionByClientAccountId(tenantB, db);
    assert.ok(ownedB);
    const ownedA = await getGoogleAccountConnectionByClientAccountId(tenantA, db);
    assert.ok(ownedA);

    const updateCross = await markGoogleConnectionReconnectRequired(
      { id: ownedB.id, clientAccountId: tenantA },
      db
    );
    assert.equal("notFound" in updateCross, true);

    const disconnectCross = await disconnectGoogleConnection(
      { id: ownedB.id, clientAccountId: tenantA },
      db
    );
    assert.equal("notFound" in disconnectCross, true);

    const casCross = await compareAndSetGoogleConnectionTokenRefresh(
      {
        id: ownedB.id,
        clientAccountId: tenantA,
        expectedTokenVersion: ownedB.tokenVersion,
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(casCross.ok, false);
    if (!casCross.ok) assert.equal(casCross.reason, "not_found");

    const steal = await upsertGoogleAccountConnectionForClient(
      {
        clientAccountId: tenantA,
        googleUserId: "google-sub-shared",
        googleEmail: "sam@example.com",
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(steal.ok, false);
    if (!steal.ok) assert.equal(steal.reason, "google_identity_owned_by_other_tenant");

    const stillB = await getGoogleAccountConnectionByClientAccountId(tenantB, db);
    assert.equal(stillB?.status, "reconnect_required");
    assert.equal(ownedA.status, "disconnected");
  });

  it("CAS omits refresh token without wiping stored refresh ciphertext", async () => {
    const connected = await upsertGoogleAccountConnectionForClient(
      {
        clientAccountId: tenantA,
        googleUserId: "google-sub-cas-optional",
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(connected.ok, true);
    if (!connected.ok) return;

    const cas = await compareAndSetGoogleConnectionTokenRefresh(
      {
        id: connected.connection.id,
        clientAccountId: tenantA,
        expectedTokenVersion: connected.connection.tokenVersion,
        accessToken: ACCESS_2,
        tokenExpiresAt: new Date(Date.now() + 7200_000),
      },
      db
    );
    assert.equal(cas.ok, true);
    if (!cas.ok) return;
    assert.equal((cas.connection as Record<string, unknown>).accessTokenEncrypted, undefined);

    const secrets = await getGoogleConnectionSecretsForTenant(
      { id: connected.connection.id, clientAccountId: tenantA },
      db
    );
    assert.equal(decryptGoogleToken(secrets!.accessTokenEncrypted!), ACCESS_2);
    assert.equal(decryptGoogleToken(secrets!.refreshTokenEncrypted!), REFRESH);
  });

  it("concurrent CAS commits exactly one refresh; stale cannot resurrect wiped tokens", async () => {
    const row = await getGoogleAccountConnectionByClientAccountId(tenantA, db);
    assert.ok(row);
    const version = row.tokenVersion;
    const [first, second] = await Promise.all([
      compareAndSetGoogleConnectionTokenRefresh(
        {
          id: row.id,
          clientAccountId: tenantA,
          expectedTokenVersion: version,
          accessToken: `${ACCESS}-cas-a`,
          refreshToken: `${REFRESH}-cas-a`,
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
        db
      ),
      compareAndSetGoogleConnectionTokenRefresh(
        {
          id: row.id,
          clientAccountId: tenantA,
          expectedTokenVersion: version,
          accessToken: `${ACCESS}-cas-b`,
          refreshToken: `${REFRESH}-cas-b`,
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
        db
      ),
    ]);
    const successes = [first, second].filter((r) => r.ok);
    const failures = [first, second].filter((r) => !r.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    if (!failures[0]!.ok) assert.equal(failures[0]!.reason, "stale_version");

    const wiped = await disconnectGoogleConnection({ id: row.id, clientAccountId: tenantA }, db);
    assert.equal("notFound" in wiped, false);
    if ("notFound" in wiped) return;
    const begunBeforeDisconnect = await compareAndSetGoogleConnectionTokenRefresh(
      {
        id: row.id,
        clientAccountId: tenantA,
        expectedTokenVersion: version,
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
      db
    );
    assert.equal(begunBeforeDisconnect.ok, false);
    if (!begunBeforeDisconnect.ok) {
      assert.ok(
        begunBeforeDisconnect.reason === "disconnected" ||
          begunBeforeDisconnect.reason === "stale_version"
      );
    }
    const secrets = await getGoogleConnectionSecretsForTenant(
      { id: row.id, clientAccountId: tenantA },
      db
    );
    assert.equal(secrets?.accessTokenEncrypted, null);
    assert.equal(secrets?.refreshTokenEncrypted, null);
  });

  it("concurrent consume of one OAuth state succeeds exactly once", async () => {
    const created = await createGoogleOAuthPendingAuthForClient(
      { clientAccountId: tenantA, returnTo: "/portal/account" },
      db
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const [a, b] = await Promise.all([
      consumeGoogleOAuthPendingAuthForClient(
        { rawState: created.state, clientAccountId: tenantA },
        db
      ),
      consumeGoogleOAuthPendingAuthForClient(
        { rawState: created.state, clientAccountId: tenantA },
        db
      ),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    if (!failures[0]!.ok) assert.equal(failures[0]!.reason, "already_consumed");
    if (successes[0]!.ok) {
      assert.ok(successes[0]!.pkceVerifier.length >= 43);
      const wiped = await db.googleOAuthPendingAuth.findUnique({
        where: { id: created.pending.id },
      });
      assert.equal(wiped?.pkceVerifierEncrypted, "");
      assert.ok(wiped?.consumedAt);
    }
  });

  it("DB partial unique index is the race-safe guard; service maps conflict to a controlled result", async () => {
    await db.googleAccountConnection.deleteMany({
      where: { clientAccountId: { in: [tenantA, tenantB] } },
    });
    const shared = `google-sub-race-${suffix}`;
    const [left, right] = await Promise.all([
      upsertGoogleAccountConnectionForClient(
        {
          clientAccountId: tenantA,
          googleUserId: shared,
          accessToken: ACCESS,
          refreshToken: REFRESH,
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
        db
      ),
      upsertGoogleAccountConnectionForClient(
        {
          clientAccountId: tenantB,
          googleUserId: shared,
          accessToken: ACCESS,
          refreshToken: REFRESH,
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
        db
      ),
    ]);
    const successes = [left, right].filter((r) => r.ok);
    const failures = [left, right].filter((r) => !r.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    if (!failures[0]!.ok) {
      assert.equal(failures[0]!.reason, "google_identity_owned_by_other_tenant");
    }

    const loserTenant = left.ok ? tenantB : tenantA;
    await assert.rejects(
      () =>
        createGoogleAccountConnection(
          {
            clientAccount: { connect: { clientAccountId: loserTenant } },
            googleUserId: shared,
            status: "connected",
            accessTokenEncrypted: encryptGoogleToken("race-access"),
            refreshTokenEncrypted: encryptGoogleToken("race-refresh"),
            tokenExpiresAt: new Date(),
          },
          db
        ),
      (err: unknown) =>
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    );
  });

  it("generic create defaults to disconnected without tokens", async () => {
    await db.googleAccountConnection.deleteMany({
      where: { clientAccountId: tenantA },
    });
    const row = await createGoogleAccountConnection(
      { clientAccount: { connect: { clientAccountId: tenantA } } },
      db
    );
    assert.equal(row.status, "disconnected");
    assert.equal(row.accessTokenEncrypted, null);
    assert.equal(row.refreshTokenEncrypted, null);
    assert.equal(row.googleUserId, null);
    assert.equal((presentGoogleAccountConnection(row) as Record<string, unknown>).accessTokenEncrypted, undefined);
  });

  it("partial unique index exists in Postgres with the active-status predicate", async () => {
    const rows = await db.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE indexname = 'GoogleAccountConnection_googleUserId_active_key'
    `;
    assert.equal(rows.length, 1);
    assert.match(rows[0]!.indexdef, /UNIQUE INDEX/i);
    assert.match(rows[0]!.indexdef, /googleUserId/);
    assert.match(rows[0]!.indexdef, /connected/);
    assert.match(rows[0]!.indexdef, /reconnect_required/);
    assert.match(rows[0]!.indexdef, /error/);
    assert.doesNotMatch(rows[0]!.indexdef, /disconnected/);
  });
});
