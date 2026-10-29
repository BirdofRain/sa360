import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminGhlAssociationDispatchRoutes } from "./admin-ghl-association-dispatch.js";

process.env.ADMIN_API_KEY ??= "route-test-admin-key";

const emptyVisibility = {
  counts: { pending: 0, executing: 0, settled: 0, uncertain: 0, failed: 0 },
  rows: [],
};

test("association dispatch visibility requires the admin key and returns counts", async () => {
  const app = Fastify({ logger: false });
  let drained = 0;
  await app.register(
    async (child) =>
      adminGhlAssociationDispatchRoutes(child, {
        list: async () => emptyVisibility,
        drain: async () => {
          drained += 1;
          return { processed: 0, delivered: 0, settled: 0, uncertain: 0 };
        },
      }),
    { prefix: "/admin/v1" }
  );

  const missing = await app.inject({ method: "GET", url: "/admin/v1/ghl/association-dispatch" });
  assert.equal(missing.statusCode, 401);

  const listed = await app.inject({
    method: "GET",
    url: "/admin/v1/ghl/association-dispatch",
    headers: { "x-sa360-admin-key": process.env.ADMIN_API_KEY ?? "" },
  });
  assert.equal(listed.statusCode, 200);
  const body = listed.json() as { ok: boolean; counts: { pending: number; uncertain: number; failed: number }; rows: unknown[] };
  assert.equal(body.ok, true);
  assert.deepEqual(body.counts, emptyVisibility.counts);
  assert.deepEqual(body.rows, []);
  assert.equal(JSON.stringify(body).includes("normalizedPayload"), false);

  const drain = await app.inject({
    method: "POST",
    url: "/admin/v1/ghl/internal/process-association-dispatch",
    headers: { "x-sa360-admin-key": process.env.ADMIN_API_KEY ?? "" },
  });
  assert.equal(drain.statusCode, 200);
  assert.equal(drained, 1);
  await app.close();
});
