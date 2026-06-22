import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  adminDeliveryReadinessRoutes,
  type AdminDeliveryReadinessRoutesDeps,
} from "./admin-delivery-readiness.js";

const HEADER = "x-sa360-admin-key";

async function buildApp(deps: AdminDeliveryReadinessRoutesDeps = {}) {
  const app = Fastify({ logger: false });
  await app.register(adminDeliveryReadinessRoutes, { prefix: "/admin/v1", ...deps });
  return app;
}

test("GET /admin/v1/delivery-readiness → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/delivery-readiness?masterClientAccountId=master_1",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/delivery-readiness with no filter returns all rows (no 400)", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  let receivedFilters: Record<string, unknown> | null = null;
  const app = await buildApp({
    listCampaignRoutingRules: (async (filters: Record<string, unknown>) => {
      receivedFilters = filters;
      return [];
    }) as unknown as AdminDeliveryReadinessRoutesDeps["listCampaignRoutingRules"],
    presentRoutingRulesWithReadinessEnriched: (async () => [
      { id: "rule_1" },
      { id: "rule_2" },
    ]) as unknown as AdminDeliveryReadinessRoutesDeps["presentRoutingRulesWithReadinessEnriched"],
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/delivery-readiness",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; count: number };
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  // No master/client filter forwarded → repository returns all rows.
  assert.equal(receivedFilters!.masterClientAccountId, undefined);
  assert.equal(receivedFilters!.clientAccountId, undefined);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/delivery-readiness still filters by masterClientAccountId", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  let receivedFilters: Record<string, unknown> | null = null;
  const app = await buildApp({
    listCampaignRoutingRules: (async (filters: Record<string, unknown>) => {
      receivedFilters = filters;
      return [];
    }) as unknown as AdminDeliveryReadinessRoutesDeps["listCampaignRoutingRules"],
    presentRoutingRulesWithReadinessEnriched: (async () => []) as unknown as AdminDeliveryReadinessRoutesDeps["presentRoutingRulesWithReadinessEnriched"],
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/delivery-readiness?masterClientAccountId=leadcapture_io",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(receivedFilters!.masterClientAccountId, "leadcapture_io");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

