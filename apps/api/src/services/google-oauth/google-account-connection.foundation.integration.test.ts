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
      payloadContainsPlaintextSecret(presentGoogleAccountConnection(fresh.row), [ACCESS_2, REFRESH_2]),
      false
    );
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
});
