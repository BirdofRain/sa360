import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { getAdminApiKey } from "../lib/admin-auth.js";

test("client cannot invoke reservation endpoint without admin key", async () => {
  const app = await buildApp();
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-key";
  try {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/fulfillment-execution/allocations/alloc_1/reserve",
    });
    assert.equal(res.statusCode, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
    await app.close();
  }
});

test("reservation endpoint rejects tenant override body", async () => {
  const app = await buildApp();
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-key";
  try {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/fulfillment-execution/allocations/alloc_1/reserve",
      headers: { "x-sa360-admin-key": getAdminApiKey()! },
      payload: { clientAccountId: "override_client", leadOrderId: "override_order" },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string };
    assert.equal(body.error, "tenant_override_not_allowed");
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
    await app.close();
  }
});

test("LF2 GHL canary preflight requires admin key", async () => {
  const app = await buildApp();
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-key";
  try {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/fulfillment-execution/instructions/instr_1/ghl-live/canary/preflight",
    });
    assert.equal(res.statusCode, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
    await app.close();
  }
});
