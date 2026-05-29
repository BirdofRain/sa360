import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminGhlLiveDeliveryRoutes } from "./admin-ghl-live-delivery.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../lib/ghl-delivery-adapter-mode.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminGhlLiveDeliveryRoutes, { prefix: "/admin/v1" });
  return app;
}

test("POST ghl-live/canary → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/delivery-plans/plan_1/ghl-live/canary",
    payload: {
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl-live/canary → 400 without exact confirmation text", async () => {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/delivery-plans/plan_1/ghl-live/canary",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { confirmLiveDeliveryRisk: true, operatorConfirmationText: "WRONG TEXT" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  else delete process.env.ADMIN_API_KEY;
  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("GET ghl-live-delivery/runs → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl-live-delivery/runs",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
