import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminClientCampaignInventoryRoutes } from "./admin-client-campaign-inventory.js";

const HEADER = "x-sa360-admin-key";

test("GET /admin/v1/clients/:id/campaign-inventory → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "campaign-inventory-secret";
  const app = Fastify({ logger: false });
  await app.register(adminClientCampaignInventoryRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/clients/client_ray/campaign-inventory",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("campaign inventory route registers only the read method", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "campaign-inventory-secret";
  const app = Fastify({ logger: false });
  await app.register(adminClientCampaignInventoryRoutes, { prefix: "/admin/v1" });
  const post = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/client_ray/campaign-inventory",
    headers: { [HEADER]: "campaign-inventory-secret" },
    payload: { campaignId: "camp_vet" },
  });
  assert.equal(post.statusCode, 404);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
