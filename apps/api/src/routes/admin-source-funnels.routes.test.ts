import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminSourceFunnelRoutes } from "./admin-source-funnels.js";
import { clientPortalRoutes } from "./client-portal.js";
import { associateSourceFunnelBodySchema } from "../schemas/source-funnel-admin.schema.js";

const HEADER = "x-sa360-admin-key";

async function buildAdminApp() {
  const app = Fastify({ logger: false });
  await app.register(adminSourceFunnelRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET /admin/v1/clients/:id/source-funnels → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/clients/madison_test_client/source-funnels",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/clients/:id/source-funnels → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/madison_test_client/source-funnels",
    payload: { pageUrlOrSlug: "dn_omzoj" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/source-funnels/:id/reassign → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/source-funnels/sf_1/reassign",
    payload: { originClientAccountId: "madison_test_client" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/source-funnels/:id/confirm → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/source-funnels/sf_1/confirm",
    payload: { originClientAccountId: "madison_test_client" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("DELETE /admin/v1/source-funnels/:id/association → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "DELETE",
    url: "/admin/v1/source-funnels/sf_1/association",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/source-funnels/observed → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/source-funnels/observed",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST associate rejects empty pageUrlOrSlug before touching persistence", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-source-funnel-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/madison_test_client/source-funnels",
    headers: { [HEADER]: "admin-source-funnel-secret" },
    payload: { pageUrlOrSlug: "   " },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: string; code?: string };
  assert.equal(body.error, "Enter a LeadCapture page URL or slug.");
  assert.equal(body.code, "invalid_page_url_or_slug");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("associateSourceFunnelBodySchema accepts slug and full URL", () => {
  assert.equal(associateSourceFunnelBodySchema.safeParse({ pageUrlOrSlug: "dn_omzoj" }).success, true);
  assert.equal(
    associateSourceFunnelBodySchema.safeParse({
      pageUrlOrSlug: "https://my.leadcapture.io/p/dn_omzoj?v=1789074011990",
    }).success,
    true
  );
  assert.equal(associateSourceFunnelBodySchema.safeParse({ pageUrlOrSlug: "" }).success, false);
  assert.equal(associateSourceFunnelBodySchema.safeParse({ originClientAccountId: "nope" }).success, false);
});

test("customer portal prefix does not expose SourceFunnel association routes", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, { prefix: "/client/v1" });
  const list = await app.inject({
    method: "GET",
    url: "/client/v1/clients/madison_test_client/source-funnels",
    headers: { "x-sa360-client-portal-key": "portal-secret" },
  });
  assert.equal(list.statusCode, 404);
  const post = await app.inject({
    method: "POST",
    url: "/client/v1/clients/madison_test_client/source-funnels",
    headers: { "x-sa360-client-portal-key": "portal-secret" },
    payload: { pageUrlOrSlug: "dn_omzoj" },
  });
  assert.equal(post.statusCode, 404);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});
