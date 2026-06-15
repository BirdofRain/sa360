import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminClientsRoutes } from "./admin-clients.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET /admin/v1/clients/:id/delivery-config → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/clients/vet_life_james_torrey/delivery-config",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/clients/:id/ghl-config → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/vet_life_james_torrey/ghl-config",
    payload: { locationId: "9xSNvQCbGaPE9YNxgl4B" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
