import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminDeliveryReadinessRoutes } from "./admin-delivery-readiness.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryReadinessRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET /admin/v1/delivery-readiness → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/delivery-readiness?masterClientAccountId=master_1",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/routing/rules → 400 without masterClientAccountId", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/routing/rules",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("PATCH /admin/v1/routing/rules/:id/delivery-config → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/v1/routing/rules/rule_1/delivery-config",
    payload: { deliveryEnabled: true },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("PATCH delivery-config with admin key does not return 401", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/v1/routing/rules/nonexistent/delivery-config",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { deliveryEnabled: true, deliveryMode: "live" },
  });
  assert.notEqual(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
