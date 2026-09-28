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

test("lead timeline scope failure is a coded 400 and other 400s stay distinct", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();

  const missing = await app.inject({
    method: "GET",
    url: "/admin/v1/coc/lead-timeline",
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, "missing_anchor");
  assert.notEqual(missing.json().code, "lead_timeline_scope_unresolved");

  const invalid = await app.inject({
    method: "GET",
    url: "/admin/v1/coc/lead-timeline?requestId=req_1&limit=nope",
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, "invalid_query");
  assert.notEqual(invalid.json().code, "lead_timeline_scope_unresolved");

  const unresolved = await app.inject({
    method: "GET",
    url: "/admin/v1/coc/lead-timeline?requestId=missing-timeline-anchor-sec027d",
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(unresolved.statusCode, 400);
  assert.equal(unresolved.json().code, "lead_timeline_scope_unresolved");
  assert.notEqual(unresolved.statusCode, 500);

  const denied = await app.inject({
    method: "GET",
    url: "/admin/v1/coc/lead-timeline?requestId=missing-timeline-anchor-sec027d",
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(denied.statusCode, 401);

  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
