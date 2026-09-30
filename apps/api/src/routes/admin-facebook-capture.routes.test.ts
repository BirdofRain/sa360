import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

import { adminFacebookCaptureRoutes } from "./admin-facebook-capture.js";

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("Facebook form association admin routes reject missing admin keys", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  await app.register(adminFacebookCaptureRoutes, { prefix: "/admin/v1" });
  try {
    const list = await app.inject({ method: "GET", url: "/admin/v1/facebook-form-associations" });
    const write = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-form-associations",
      headers: { "content-type": "application/json", "x-sa360-admin-key": "wrong" },
      payload: { pageId: "900000000000101", formId: "900000000000201", clientAccountId: "client_a" },
    });
    const reeval = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-capture/events/evt_1/reevaluate-association",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    assert.equal(list.statusCode, 401);
    assert.equal(write.statusCode, 401);
    assert.equal(reeval.statusCode, 401);
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});
