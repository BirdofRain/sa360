import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { webhookRoutes } from "./webhook.js";

test("debug webhook routes return 404 when ENABLE_DEBUG_ROUTES is unset", async () => {
  const prev = process.env.ENABLE_DEBUG_ROUTES;
  delete process.env.ENABLE_DEBUG_ROUTES;

  const app = Fastify({ logger: false });
  await app.register(webhookRoutes);

  const webhookTestGetRes = await app.inject({
    method: "GET",
    url: "/webhooks/ghl/test",
  });
  assert.equal(webhookTestGetRes.statusCode, 404);

  const webhookTestPostRes = await app.inject({
    method: "POST",
    url: "/webhooks/ghl/test",
  });
  assert.equal(webhookTestPostRes.statusCode, 404);

  const debugEventRes = await app.inject({
    method: "GET",
    url: "/debug/test-event",
  });
  assert.equal(debugEventRes.statusCode, 404);

  await app.close();
  if (prev !== undefined) process.env.ENABLE_DEBUG_ROUTES = prev;
});

test("debug webhook test route remains available when ENABLE_DEBUG_ROUTES=true", async () => {
  const prev = process.env.ENABLE_DEBUG_ROUTES;
  process.env.ENABLE_DEBUG_ROUTES = "true";

  const app = Fastify({ logger: false });
  await app.register(webhookRoutes);

  const webhookTestRes = await app.inject({
    method: "GET",
    url: "/webhooks/ghl/test",
  });
  assert.equal(webhookTestRes.statusCode, 200);
  assert.deepEqual(webhookTestRes.json(), {
    ok: true,
    message: "Webhook test endpoint live",
  });

  await app.close();
  if (prev !== undefined) process.env.ENABLE_DEBUG_ROUTES = prev;
  else delete process.env.ENABLE_DEBUG_ROUTES;
});
