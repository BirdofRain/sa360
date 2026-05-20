import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { getClientDashboard } from "../services/client-dashboard.service.js";
import { clientPortalRoutes } from "./client-portal.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    getClientDashboardImpl: (params, deps) =>
      getClientDashboard(params, deps ?? { prisma: createEmptyPrismaMock(), now: () => new Date() }),
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

test("GET /client/v1/dashboard → 200 with contract when configured", async () => {
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
  assert.ok(body.funnel);
  assert.ok(body.systemHealth);
  assert.ok(Array.isArray(body.recentActivity));
  const funnel = body.funnel as { leadsReceived: number };
  assert.equal(funnel.leadsReceived, 0);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});
