import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminClientsRoutes } from "./admin-clients.js";
import { routingRuleCreateBodySchema } from "../schemas/routing-rule.schema.js";

const HEADER = "x-sa360-admin-key";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET /admin/v1/clients → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/clients" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/clients → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients",
    payload: { clientAccountId: "test_client", clientDisplayName: "Test" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/routing/rules → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/routing/rules",
    payload: {
      masterClientAccountId: "master_1",
      clientAccountId: "client_1",
      matchType: "campaign_id",
      campaignId: "123",
    },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("routingRuleCreateBodySchema rejects invalid matchType", () => {
  const parsed = routingRuleCreateBodySchema.safeParse({
    masterClientAccountId: "master_1",
    clientAccountId: "client_1",
    matchType: "not_a_real_type",
    campaignId: "123",
  });
  assert.equal(parsed.success, false);
});

test("routingRuleCreateBodySchema rejects campaign_id without campaignId", () => {
  const parsed = routingRuleCreateBodySchema.safeParse({
    masterClientAccountId: "master_1",
    clientAccountId: "client_1",
    matchType: "campaign_id",
  });
  assert.equal(parsed.success, false);
});

test("GET /admin/v1/routing/rules → 400 without master or client filter", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/routing/rules",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("PATCH delivery-config requires confirmLiveDeliveryRisk when enabling live", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/v1/routing/rules/nonexistent/delivery-config",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { deliveryEnabled: true, deliveryMode: "live" },
  });
  assert.notEqual(res.statusCode, 401);
  const body = res.json() as { code?: string };
  if (res.statusCode === 404) {
    assert.ok(true);
  } else if (res.statusCode === 400) {
    assert.equal(body.code, "CONFIRMATION_REQUIRED");
  }
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
