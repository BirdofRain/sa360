import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

import { adminLeadInventoryRoutes, httpStatusForFacetInternalRebuild } from "./admin-lead-inventory.js";

test("GET /lead-inventory/facets requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "facets-route-key";
  try {
    const app = Fastify({ logger: false });
    await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
    const unauthorized = await app.inject({
      method: "GET",
      url: "/admin/v1/lead-inventory/facets",
    });
    assert.equal(unauthorized.statusCode, 401);
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
});

test("GET /lead-inventory/facets rejects unknown query params", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "facets-route-key";
  try {
    const app = Fastify({ logger: false });
    await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/lead-inventory/facets?notARealFilter=1",
      headers: { "x-sa360-admin-key": "facets-route-key" },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.ok, false);
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
});

test("internal facet rebuild HTTP status is 500 when snapshot rebuild is not ok", () => {
  assert.equal(httpStatusForFacetInternalRebuild({ ok: false }), 500);
  assert.equal(httpStatusForFacetInternalRebuild({ ok: true }), 200);
});
