import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminGhlOAuthRoutes, integrationsGhlRoutes } from "./integrations-ghl.js";
import { handleGhlMarketplaceWebhook } from "../services/ghl-oauth/ghl-connection.service.js";

const HEADER = "x-sa360-admin-key";

test("GET ghl/oauth/start → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({ method: "GET", url: "/admin/v1/ghl/oauth/start" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl/connections/:id/probe → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/ghl/connections/conn_1/probe",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /integrations/ghl/webhooks accepts INSTALL payload", async () => {
  const result = await handleGhlMarketplaceWebhook({
    type: "INSTALL",
    locationId: "loc_test_123",
    companyId: "co_1",
    appId: "app_1",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.handled, true);
});

test("GET /integrations/oauth/callback → 400 without code", async () => {
  const app = Fastify({ logger: false });
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  const res = await app.inject({
    method: "GET",
    url: "/integrations/oauth/callback?state=abc",
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
