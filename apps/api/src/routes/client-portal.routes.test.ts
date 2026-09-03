import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { hashPortalPassword } from "../lib/portal-password.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { getClientDashboard } from "../services/client-dashboard.service.js";
import { clientPortalRoutes } from "./client-portal.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;

function prismaWithPortalAccount(
  overrides: Partial<{
    portalEnabled: boolean;
    clientAccountId: string;
    portalPasswordHash: string | null;
    portalSessionEpoch: number;
  }> = {}
) {
  const clientAccountId = overrides.clientAccountId ?? "acct_portal";
  const portalEnabled = overrides.portalEnabled ?? true;
  const row = {
    clientAccountId,
    clientDisplayName: "Portal Client",
    portalEnabled,
    portalDisplayName: "Portal Display",
    portalLoginEmail: "portal@example.com",
    portalPasswordHash: overrides.portalPasswordHash ?? null,
    portalPasswordSetAt: null,
    portalSessionEpoch: overrides.portalSessionEpoch ?? 0,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: null,
  };
  const base = createEmptyPrismaMock();
  return {
    ...base,
    clientAccount: {
      findUnique: async () => row,
      findFirst: async () => row,
    },
  } as unknown as ReturnType<typeof createEmptyPrismaMock>;
}

async function buildApp(prisma = createEmptyPrismaMock()) {
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: prisma },
    getClientDashboardImpl: (params, deps) =>
      getClientDashboard(params, deps ?? { prisma, now: () => new Date() }),
  });
  return app;
}

test("GET /client/v1/dashboard → 503 when portal key unset", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  delete process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `${PREFIX}/dashboard` });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
});

test("GET /client/v1/dashboard → 401 when key invalid", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_test";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/dashboard`,
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("GET /client/v1/dashboard → 200 with env fallback when configured", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_test";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/dashboard?range=7d`,
    headers: { [HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("GET /client/v1/dashboard → 403 when portal disabled for scoped account", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithPortalAccount({ portalEnabled: false });
  const app = await buildApp(prisma);
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/dashboard?clientAccountId=acct_portal&range=7d`,
    headers: { [HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 403);
  const body = res.json() as { code?: string };
  assert.equal(body.code, "PORTAL_DISABLED");
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("GET /client/v1/dashboard → 404 for unknown clientAccountId param", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/dashboard?clientAccountId=missing_acct&range=7d`,
    headers: { [HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("GET /client/v1/portal-context → 200 when login email matches", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithPortalAccount();
  const app = await buildApp(prisma);
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/portal-context?loginEmail=portal@example.com`,
    headers: { [HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as {
    context: {
      clientAccountId: string;
      hasPortalPassword?: boolean;
      portalSessionEpoch?: number;
      portalPasswordHash?: unknown;
    };
  };
  assert.equal(body.context.clientAccountId, "acct_portal");
  assert.equal(body.context.hasPortalPassword, false);
  assert.equal(body.context.portalSessionEpoch, 0);
  assert.equal("portalPasswordHash" in body.context, false);
  assert.equal(JSON.stringify(body).includes("portalPasswordHash"), false);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-login verifies customer hash and omits secrets", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const customerPassword = "acct-portal-unique";
  const hash = await hashPortalPassword(customerPassword);
  const prisma = prismaWithPortalAccount({
    portalPasswordHash: hash,
    portalSessionEpoch: 2,
  });
  const app = await buildApp(prisma);
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-login`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: { loginEmail: "portal@example.com", password: customerPassword },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as {
    passwordCheck: string;
    portalSessionEpoch: number;
    context: Record<string, unknown>;
  };
  assert.equal(body.passwordCheck, "customer");
  assert.equal(body.portalSessionEpoch, 2);
  assert.equal(body.context.hasPortalPassword, true);
  assert.equal("portalPasswordHash" in body.context, false);
  assert.equal(res.body.includes(customerPassword), false);
  assert.equal(res.body.includes(hash), false);
  assert.equal(res.body.includes("shared-env-pass"), false);

  const envAttempt = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-login`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: { loginEmail: "portal@example.com", password: "shared-env-pass" },
  });
  assert.equal(envAttempt.statusCode, 401);
  assert.equal(envAttempt.json().error, "Email or password is incorrect. Please try again.");
  assert.equal(envAttempt.body.includes(hash), false);

  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("POST /client/v1/portal-login authenticates a hashed customer without CLIENT_PORTAL_LOGIN_PASSWORD", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  const customerPassword = "acct-portal-unique";
  const hash = await hashPortalPassword(customerPassword);
  const prisma = prismaWithPortalAccount({
    portalPasswordHash: hash,
    portalSessionEpoch: 5,
  });
  const app = await buildApp(prisma);
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-login`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: { loginEmail: "portal@example.com", password: customerPassword },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { passwordCheck: string; portalSessionEpoch: number };
  assert.equal(body.passwordCheck, "customer");
  assert.equal(body.portalSessionEpoch, 5);
  assert.equal(res.body.includes(customerPassword), false);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("GET /client/v1/portal-session-state returns epoch only", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const hash = await hashPortalPassword("acct-portal-unique");
  const prisma = prismaWithPortalAccount({
    portalPasswordHash: hash,
    portalSessionEpoch: 9,
  });
  const app = await buildApp(prisma);
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/portal-session-state?clientAccountId=acct_portal`,
    headers: { [HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.portalSessionEpoch, 9);
  assert.equal(body.portalEnabled, true);
  assert.equal("portalPasswordHash" in body, false);
  assert.equal(res.body.includes(hash), false);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});
