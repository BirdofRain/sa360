import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminClientChannelProfileRoutes } from "./admin-client-channel-profile.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminClientChannelProfileRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET channel-profile → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/clients/client_1/channel-profile",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST channel-profile → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/client_1/channel-profile",
    payload: { greenEnabled: true },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET channel-profile → 404 when feature flag disabled", async () => {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevFlag = process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED = "false";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/clients/client_1/channel-profile",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as { code?: string };
  assert.equal(body.code, "FEATURE_DISABLED");
  await app.close();
  if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  else delete process.env.ADMIN_API_KEY;
  if (prevFlag !== undefined) process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED = prevFlag;
  else delete process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED;
});

test("POST ghl-mirror/preview → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/client_1/channel-profile/ghl-mirror/preview",
    payload: {},
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl-mirror/apply → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/client_1/channel-profile/ghl-mirror/apply",
    payload: {},
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl-mirror/preview → 404 when feature flag disabled", async () => {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevFlag = process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED = "false";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/client_1/channel-profile/ghl-mirror/preview",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: {},
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as { code?: string };
  assert.equal(body.code, "FEATURE_DISABLED");
  await app.close();
  if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  else delete process.env.ADMIN_API_KEY;
  if (prevFlag !== undefined) process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED = prevFlag;
  else delete process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED;
});

test("POST channel-profile → 400 on invalid body (with key, feature enabled)", async () => {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevFlag = process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED = "true";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/client_1/channel-profile",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { textStartHour: 99 },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  else delete process.env.ADMIN_API_KEY;
  if (prevFlag !== undefined) process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED = prevFlag;
  else delete process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED;
});
