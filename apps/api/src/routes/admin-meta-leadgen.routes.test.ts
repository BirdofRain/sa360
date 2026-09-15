import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminMetaLeadgenRoutes } from "./admin-meta-leadgen.js";

test("internal meta-leadgen process-fetch requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "meta-leadgen-admin";
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/meta-leadgen/internal/process-fetch",
    payload: { leadgenId: "x", sourceLeadEventId: "y" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prev;
});

test("internal meta-leadgen process-fetch is disabled when no admin key is configured", async () => {
  const prevAdmin = process.env.ADMIN_API_KEY;
  const prevAlias = process.env.SA360_ADMIN_KEY;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/meta-leadgen/internal/process-fetch",
    payload: { leadgenId: "x", sourceLeadEventId: "y" },
  });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prevAdmin === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prevAdmin;
  if (prevAlias === undefined) delete process.env.SA360_ADMIN_KEY;
  else process.env.SA360_ADMIN_KEY = prevAlias;
});

test("internal meta-leadgen process-fetch rejects an invalid body after auth", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "meta-leadgen-admin";
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/meta-leadgen/internal/process-fetch",
    headers: { "x-sa360-admin-key": "meta-leadgen-admin" },
    payload: { leadgenId: "" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_body");
  await app.close();
  if (prev === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prev;
});
