import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminLiveLeadPoolRoutes } from "./admin-live-lead-pool.js";

test("GET /admin/v1/live-lead-pool → 401 without admin key", async () => {
  const app = Fastify({ logger: false });
  await app.register(adminLiveLeadPoolRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({ method: "GET", url: "/admin/v1/live-lead-pool" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("GET /admin/v1/demand-queue → 401 without admin key", async () => {
  const app = Fastify({ logger: false });
  await app.register(adminLiveLeadPoolRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({ method: "GET", url: "/admin/v1/demand-queue" });
  assert.equal(res.statusCode, 401);
  await app.close();
});
