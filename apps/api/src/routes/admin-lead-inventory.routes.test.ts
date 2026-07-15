import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminLeadInventoryRoutes } from "./admin-lead-inventory.js";

test("GET /lead-inventory/summary requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "inventory-test-key";
  try {
    const app = Fastify({ logger: false });
    await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
    const unauthorized = await app.inject({
      method: "GET",
      url: "/admin/v1/lead-inventory/summary",
    });
    assert.equal(unauthorized.statusCode, 401);
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
});

test("POST /lead-inventory/import-preview rejects invalid body", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "inventory-test-key";
  try {
    const app = Fastify({ logger: false });
    await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/lead-inventory/import-preview",
      headers: { "x-sa360-admin-key": "inventory-test-key" },
      payload: { limit: 9999 },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
});
