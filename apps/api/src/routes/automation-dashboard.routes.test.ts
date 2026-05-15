import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { automationDashboardRoutes } from "./automation-dashboard.js";

const HEADER = "x-sa360-admin-key";
const PREFIX = "/admin/v1/automation-dashboard";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(automationDashboardRoutes, { prefix: PREFIX });
  return app;
}

test("GET automation-dashboard/summary → 503 when admin key unset", async () => {
  const prev = process.env.ADMIN_API_KEY;
  const prevK = process.env.SA360_ADMIN_KEY;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `${PREFIX}/summary` });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
  if (prevK !== undefined) process.env.SA360_ADMIN_KEY = prevK;
  else delete process.env.SA360_ADMIN_KEY;
});

test("GET automation-dashboard/summary → 401 when key wrong", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/summary`,
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET automation-dashboard/workflow-progression → 401 when key wrong", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/workflow-progression?range=7d`,
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET automation-dashboard/summary → 400 on invalid query", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/summary?from=not-a-date`,
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
