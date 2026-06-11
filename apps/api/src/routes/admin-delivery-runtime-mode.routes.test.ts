import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminDeliveryRuntimeModeRoutes } from "./admin-delivery-runtime-mode.js";
import {
  ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
  RETURN_TO_SIMULATE_CONFIRMATION_TEXT,
} from "../services/delivery-runtime-mode.service.js";

const HEADER = "x-sa360-admin-key";

test("GET /delivery-runtime-mode requires admin auth", async () => {
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryRuntimeModeRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({ method: "GET", url: "/admin/v1/delivery-runtime-mode" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("POST /delivery-runtime-mode rejects bad confirmation", async () => {
  const prev = process.env.ADMIN_API_KEY;
  const prevMax = process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryRuntimeModeRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/delivery-runtime-mode",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      mode: "live_canary",
      durationMinutes: 15,
      operatorConfirmationText: "wrong",
      reason: "test",
    },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { code?: string };
  assert.equal(body.code, "CONFIRMATION");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
  if (prevMax !== undefined) process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = prevMax;
  else delete process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
});

test("GET /delivery-runtime-mode returns status shape", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryRuntimeModeRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/delivery-runtime-mode",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    ok: boolean;
    effectiveMode: string;
    maxAllowedMode: string;
    canRunLiveCanary: boolean;
  };
  assert.equal(body.ok, true);
  assert.ok(body.effectiveMode);
  assert.ok(body.maxAllowedMode);
  assert.equal(typeof body.canRunLiveCanary, "boolean");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST enable live canary with valid confirmation", async () => {
  const prev = process.env.ADMIN_API_KEY;
  const prevMax = process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryRuntimeModeRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/delivery-runtime-mode",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      mode: "live_canary",
      durationMinutes: 15,
      operatorConfirmationText: ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
      reason: "API route test",
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { effectiveMode: string; canRunLiveCanary: boolean };
  assert.equal(body.effectiveMode, "live_canary");
  assert.equal(body.canRunLiveCanary, true);

  const back = await app.inject({
    method: "POST",
    url: "/admin/v1/delivery-runtime-mode",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      mode: "simulate",
      operatorConfirmationText: RETURN_TO_SIMULATE_CONFIRMATION_TEXT,
    },
  });
  assert.equal(back.statusCode, 200);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
  if (prevMax !== undefined) process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = prevMax;
  else delete process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
});
