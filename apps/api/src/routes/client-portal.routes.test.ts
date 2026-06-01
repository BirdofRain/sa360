import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { getClientDashboard } from "../services/client-dashboard.service.js";
import { clientPortalRoutes } from "./client-portal.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;

function prismaWithPortalAccount(
  overrides: Partial<{
    portalEnabled: boolean;
    clientAccountId: string;
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
  const body = res.json() as { context: { clientAccountId: string } };
  assert.equal(body.context.clientAccountId, "acct_portal");
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});
