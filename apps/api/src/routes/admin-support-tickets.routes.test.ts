import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminSupportTicketRoutes } from "./admin-support-tickets.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminSupportTicketRoutes, { prefix: "/admin/v1" });
  return app;
}

test("POST /admin/v1/support-tickets → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/support-tickets",
    payload: { description: "Test issue" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/support-tickets → 400 when description missing", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/support-tickets",
    headers: { [HEADER]: "admin-secret" },
    payload: { description: "   " },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/support-tickets → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/support-tickets" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
