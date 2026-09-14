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
