import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminBulkImportsRoutes } from "./admin-bulk-imports.js";

test("bulk imports API returns 404 when feature flag disabled", async () => {
  const prev = process.env.SA360_BULK_SOURCE_IMPORTS_ENABLED;
  process.env.SA360_BULK_SOURCE_IMPORTS_ENABLED = "false";
  process.env.NODE_ENV = "production";
  const prevAdmin = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin";

  const app = Fastify({ logger: false });
  await app.register(adminBulkImportsRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/bulk-imports",
    headers: { "x-sa360-admin-key": "test-admin" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();

  if (prev !== undefined) process.env.SA360_BULK_SOURCE_IMPORTS_ENABLED = prev;
  else delete process.env.SA360_BULK_SOURCE_IMPORTS_ENABLED;
  if (prevAdmin !== undefined) process.env.ADMIN_API_KEY = prevAdmin;
  else delete process.env.ADMIN_API_KEY;
});
