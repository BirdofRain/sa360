import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminRoutes } from "./admin.js";

const HEADER = "x-sa360-admin-key";

async function buildAdminOnlyApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET /admin/v1/health → 503 when ADMIN_API_KEY unset", async () => {
  const prev = process.env.ADMIN_API_KEY;
  delete process.env.ADMIN_API_KEY;
  const app = await buildAdminOnlyApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/health" });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
});

test("GET /admin/v1/health → 401 when key wrong", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildAdminOnlyApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/health",
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/health → 200 with correct key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildAdminOnlyApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/health",
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.service, "admin");
  assert.equal(typeof body.timestamp, "string");
  assert.equal(typeof body.env, "string");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
