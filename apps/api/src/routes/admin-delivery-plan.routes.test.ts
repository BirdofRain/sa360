import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminDeliveryPlanRoutes } from "./admin-delivery-plan.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryPlanRoutes, { prefix: "/admin/v1" });
  return app;
}

test("POST delivery-plan → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/routing/dry-run-decisions/dec_1/delivery-plan",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/delivery-plans → 400 without masterClientAccountId", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/delivery-plans",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("PATCH delivery-plans status → 400 on invalid status", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/v1/delivery-plans/plan_1/status",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { status: "not_valid" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
