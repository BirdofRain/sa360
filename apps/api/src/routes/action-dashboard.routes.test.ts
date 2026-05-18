import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { actionDashboardRoutes } from "./action-dashboard.js";

const HEADER = "x-sa360-admin-key";
const PREFIX = "/admin/v1/action-dashboard";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(actionDashboardRoutes, { prefix: PREFIX });
  return app;
}

test("GET action-dashboard/today → 503 when admin key unset", async () => {
  const prev = process.env.ADMIN_API_KEY;
  const prevK = process.env.SA360_ADMIN_KEY;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/today?clientAccountId=demo`,
  });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
  if (prevK !== undefined) process.env.SA360_ADMIN_KEY = prevK;
  else delete process.env.SA360_ADMIN_KEY;
});

test("GET action-dashboard/today → 401 when key wrong", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/today?clientAccountId=demo`,
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET action-dashboard/today → 400 when clientAccountId missing", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/today`,
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET action-dashboard/today → 200 with contract keys", async () => {
  const prev = process.env.ADMIN_API_KEY;
  const prevEnv = process.env.NODE_ENV;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  process.env.NODE_ENV = "production";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/today?clientAccountId=demo&locationId=loc_demo`,
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.ok(body.subaccount);
  assert.ok(body.summary);
  assert.ok(Array.isArray(body.priorityLeads));
  assert.ok(Array.isArray(body.aiActivity));
  assert.ok(Array.isArray(body.setupWarnings));
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
  if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
  else delete process.env.NODE_ENV;
});

test("POST action-dashboard/actions → 400 when required fields missing", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/actions`,
    headers: { [HEADER]: "secret-admin-key", "content-type": "application/json" },
    payload: { actionCode: "CALL_ATTEMPT" },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean };
  assert.equal(body.ok, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST action-dashboard/actions → 400 when FOLLOW_UP missing notes and due", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/actions`,
    headers: { [HEADER]: "secret-admin-key", "content-type": "application/json" },
    payload: {
      clientAccountId: "client_a",
      contactIdGhl: "ghl_1",
      phoneE164: "+15551234567",
      actionCode: "FOLLOW_UP",
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
