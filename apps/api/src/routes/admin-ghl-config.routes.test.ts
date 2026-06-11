import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminGhlConfigRoutes } from "./admin-ghl-config.js";
import { discoverGhlLocationConfig } from "../services/ghl-config-discovery/ghl-config-discovery.service.js";
import { checkRoutingRuleGhlLocationMismatch } from "../services/ghl-config-discovery/routing-rule-ghl-config.service.js";
import { routingRuleGhlConfigBodySchema } from "../schemas/ghl-config.schema.js";

const HEADER = "x-sa360-admin-key";

test("GET ghl/locations/:locationId/config requires admin auth", async () => {
  const app = Fastify({ logger: false });
  await app.register(adminGhlConfigRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl/locations/loc_test/config",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("POST routing/rules/:id/ghl-config requires admin auth", async () => {
  const app = Fastify({ logger: false });
  await app.register(adminGhlConfigRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/routing/rules/rule_test/ghl-config",
    payload: { locationId: "loc_1", destinationPipelineIdGhl: "p1" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("discoverGhlLocationConfig rejects missing OAuth connection", async () => {
  const result = await discoverGhlLocationConfig(
    {
      locationId: "loc_no_oauth_xyz",
      refresh: true,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    },
    { findGhlLocationConnectionByLocationId: async () => null }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NOT_CONNECTED");
});

test("checkRoutingRuleGhlLocationMismatch rejects mismatched location without confirm", () => {
  const mismatch = checkRoutingRuleGhlLocationMismatch("loc_a", "loc_b");
  assert.ok(mismatch);
  assert.equal(mismatch.code, "LOCATION_MISMATCH");
  assert.equal(checkRoutingRuleGhlLocationMismatch("loc_a", "loc_b", true), null);
});

test("routingRuleGhlConfigBodySchema rejects unknown keys", () => {
  const parsed = routingRuleGhlConfigBodySchema.safeParse({
    locationId: "loc_1",
    deliveryEnabled: true,
  });
  assert.equal(parsed.success, false);
});
