/**
 * Local sa360_test-only regression: per-customer login without CLIENT_PORTAL_LOGIN_PASSWORD.
 * Does not use production credentials. Does not modify product login semantics beyond
 * proving the API already authenticates converted hashes when the shared password is absent.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../../lib/client-portal-auth.js";
import { hashPortalPassword } from "../../lib/portal-password.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { clientPortalRoutes } from "../../routes/client-portal.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PORTAL_PREFIX = "/client/v1";
const PORTAL_TEST_KEY = "retire-shared-pw-portal-key-20260903";
const TENANT_A_ID = "client_portal_retire_a_20260903";
const TENANT_B_ID = "client_portal_retire_b_20260903";
const TENANT_A_EMAIL = "tenant.a.retire.20260903@example.test";
const TENANT_B_EMAIL = "tenant.b.retire.20260903@example.test";
const TENANT_A_PASSWORD = "tenant-a-retire-individual-20260903";
const SHARED_PASSWORD = "shared-env-retire-20260903";

describe("portal-auth shared-password retirement (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const previousEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!integrationUrlRaw) {
      throw new Error(
        "SA360_TEST_DATABASE_URL is required for this Cloud validation run (local sa360_test only)"
      );
    }
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;

    for (const key of ["CLIENT_PORTAL_LOGIN_PASSWORD", "CLIENT_PORTAL_API_KEY"]) {
      previousEnv[key] = process.env[key];
    }
    delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
    process.env.CLIENT_PORTAL_API_KEY = PORTAL_TEST_KEY;

    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
    await cleanup();
    const hash = await hashPortalPassword(TENANT_A_PASSWORD);
    await db.clientAccount.create({
      data: {
        clientAccountId: TENANT_A_ID,
        clientDisplayName: "Retire Shared Password Tenant A",
        status: "active",
        portalEnabled: true,
        portalDisplayName: "Tenant A Portal",
        portalLoginEmail: TENANT_A_EMAIL,
        portalPasswordHash: hash,
        portalPasswordSetAt: new Date(),
        portalSessionEpoch: 2,
        notes: "Localhost-only shared-password retirement tenant A",
      },
    });
    await db.clientAccount.create({
      data: {
        clientAccountId: TENANT_B_ID,
        clientDisplayName: "Retire Shared Password Tenant B",
        status: "active",
        portalEnabled: true,
        portalDisplayName: "Tenant B Portal",
        portalLoginEmail: TENANT_B_EMAIL,
        portalPasswordHash: null,
        portalPasswordSetAt: null,
        portalSessionEpoch: 0,
        notes: "Localhost-only shared-password retirement tenant B",
      },
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
    await db.clientAccount.deleteMany({
      where: {
        OR: [
          { clientAccountId: { in: [TENANT_A_ID, TENANT_B_ID] } },
          { portalLoginEmail: { in: [TENANT_A_EMAIL, TENANT_B_EMAIL] } },
        ],
      },
    });
  }

  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(clientPortalRoutes, {
      prefix: PORTAL_PREFIX,
      tenantDeps: { db },
    });
    return app;
  }

  function portalHeaders(): Record<string, string> {
    return {
      [CLIENT_PORTAL_KEY_HEADER]: PORTAL_TEST_KEY,
      "content-type": "application/json",
    };
  }

  it("converted Tenant A succeeds and null-hash Tenant B stays env_fallback-only when shared password is absent", async () => {
    const app = await buildApp();
    try {
      delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;

      const converted = await app.inject({
        method: "POST",
        url: `${PORTAL_PREFIX}/portal-login`,
        headers: portalHeaders(),
        payload: { loginEmail: TENANT_A_EMAIL, password: TENANT_A_PASSWORD },
      });
      assert.equal(converted.statusCode, 200, converted.body);
      const convertedBody = converted.json() as {
        passwordCheck: string;
        context: { clientAccountId: string };
      };
      assert.equal(convertedBody.passwordCheck, "customer");
      assert.equal(convertedBody.context.clientAccountId, TENANT_A_ID);
      assert.equal(converted.body.includes(TENANT_A_PASSWORD), false);

      const convertedWrong = await app.inject({
        method: "POST",
        url: `${PORTAL_PREFIX}/portal-login`,
        headers: portalHeaders(),
        payload: { loginEmail: TENANT_A_EMAIL, password: SHARED_PASSWORD },
      });
      assert.equal(convertedWrong.statusCode, 401);

      const nullHash = await app.inject({
        method: "POST",
        url: `${PORTAL_PREFIX}/portal-login`,
        headers: portalHeaders(),
        payload: { loginEmail: TENANT_B_EMAIL, password: TENANT_A_PASSWORD },
      });
      assert.equal(nullHash.statusCode, 200, nullHash.body);
      const nullHashBody = nullHash.json() as { passwordCheck: string };
      assert.equal(nullHashBody.passwordCheck, "env_fallback");

      process.env.CLIENT_PORTAL_LOGIN_PASSWORD = SHARED_PASSWORD;

      const nullHashLegacy = await app.inject({
        method: "POST",
        url: `${PORTAL_PREFIX}/portal-login`,
        headers: portalHeaders(),
        payload: { loginEmail: TENANT_B_EMAIL, password: SHARED_PASSWORD },
      });
      assert.equal(nullHashLegacy.statusCode, 200, nullHashLegacy.body);
      assert.equal(nullHashLegacy.json().passwordCheck, "env_fallback");

      const sharedAgainstConverted = await app.inject({
        method: "POST",
        url: `${PORTAL_PREFIX}/portal-login`,
        headers: portalHeaders(),
        payload: { loginEmail: TENANT_A_EMAIL, password: SHARED_PASSWORD },
      });
      assert.equal(sharedAgainstConverted.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
