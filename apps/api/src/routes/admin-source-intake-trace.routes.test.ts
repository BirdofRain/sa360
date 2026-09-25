import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminRoutes } from "./admin.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET source-intake-trace requires the admin key and does not accept writes", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const denied = await app.inject({
    method: "GET",
    url: "/admin/v1/coc/source-intake-trace?sourceLeadEventId=evt_1",
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(denied.statusCode, 401);

  const missing = await app.inject({
    method: "GET",
    url: "/admin/v1/coc/source-intake-trace",
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(missing.statusCode, 400);

  const posted = await app.inject({
    method: "POST",
    url: "/admin/v1/coc/source-intake-trace",
    headers: { [HEADER]: "secret-admin-key" },
    payload: { sourceLeadEventId: "evt_1" },
  });
  assert.equal(posted.statusCode, 404);

  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
