import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../app.js";
import { getAdminApiKey } from "../lib/admin-auth.js";

test("GET /admin/v1/fulfillment-ops/orders/:orderId/latest-evidence → 401 without admin key", async () => {
  const app = await buildApp();
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-key";
  try {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/fulfillment-ops/orders/order_1/latest-evidence",
    });
    assert.equal(res.statusCode, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
    await app.close();
  }
});

test("GET /admin/v1/fulfillment-ops/safety → 401 without admin key", async () => {
  const app = await buildApp();
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-key";
  try {
    const res = await app.inject({ method: "GET", url: "/admin/v1/fulfillment-ops/safety" });
    assert.equal(res.statusCode, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
    await app.close();
  }
});

test("GET /admin/v1/fulfillment-ops/safety → simulation-only posture", async () => {
  const app = await buildApp();
  const prev = process.env.ADMIN_API_KEY;
  const prevExec = process.env.SA360_LF2_EXECUTION_ENABLED;
  const prevCanary = process.env.SA360_LF2_GHL_CANARY_ENABLED;
  process.env.ADMIN_API_KEY = "test-admin-key";
  delete process.env.SA360_LF2_EXECUTION_ENABLED;
  delete process.env.SA360_LF2_GHL_CANARY_ENABLED;

  try {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/fulfillment-ops/safety",
      headers: { "x-sa360-admin-key": getAdminApiKey()! },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      safety: {
        simulationOnly: boolean;
        liveDeliveryEnabled: boolean;
        liveDeliveryStatus: string;
        lf2ExecutionEnabled: boolean;
        safetyMessage: string;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.safety.simulationOnly, true);
    assert.equal(body.safety.liveDeliveryEnabled, false);
    assert.equal(body.safety.liveDeliveryStatus, "LIVE DISABLED");
    assert.equal(body.safety.lf2ExecutionEnabled, false);
    assert.match(body.safety.safetyMessage, /Simulation only/i);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
    if (prevExec === undefined) delete process.env.SA360_LF2_EXECUTION_ENABLED;
    else process.env.SA360_LF2_EXECUTION_ENABLED = prevExec;
    if (prevCanary === undefined) delete process.env.SA360_LF2_GHL_CANARY_ENABLED;
    else process.env.SA360_LF2_GHL_CANARY_ENABLED = prevCanary;
    await app.close();
  }
});
