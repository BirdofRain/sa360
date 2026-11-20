import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import Fastify from "fastify";

import { ADMIN_KEY_HEADER } from "../lib/admin-auth.js";
import { adminDeliveryHealthRoutes } from "./admin-delivery-health.js";

const KEY = "delivery-health-route-test";

let previousKey: string | undefined;

before(() => {
  previousKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = KEY;
});

after(() => {
  if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previousKey;
});

test("the scan route stays off and does not call the monitor", async () => {
  let calls = 0;
  const app = Fastify();
  await app.register(adminDeliveryHealthRoutes, {
    env: {},
    run: async () => {
      calls += 1;
      throw new Error("monitor should not run");
    },
  });
  const missing = await app.inject({ method: "POST", url: "/delivery-health/internal/scan" });
  assert.equal(missing.statusCode, 401);
  const off = await app.inject({
    method: "POST",
    url: "/delivery-health/internal/scan",
    headers: { [ADMIN_KEY_HEADER]: KEY },
  });
  assert.equal(off.statusCode, 200);
  assert.equal(off.json().skipped, "flag_off");
  assert.equal(off.json().notificationSkipped, "notify_disabled");
  assert.equal(calls, 0);
  await app.close();
});

test("a failed scan returns a stable error and a dry run omits lead fields", async () => {
  const app = Fastify();
  await app.register(adminDeliveryHealthRoutes, {
    env: { SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true" },
    run: async () => ({
      ok: false,
      queried: true,
      dryRun: true,
      pilotClients: 1,
      pilotIdsRejected: 0,
      findings: 0,
      opened: 0,
      updated: 0,
      resolved: 0,
      suppressedResolved: 0,
      notified: 0,
      notificationSkipped: "notify_disabled",
      failureClasses: [],
      truncated: false,
      heartbeat: "failed",
    }),
  });
  const failed = await app.inject({
    method: "POST",
    url: "/delivery-health/internal/scan",
    headers: { [ADMIN_KEY_HEADER]: KEY },
  });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(failed.json(), { ok: false, error: "scan_failed" });
  await app.close();

  const dry = Fastify();
  await dry.register(adminDeliveryHealthRoutes, {
    env: {
      SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
      SA360_DELIVERY_HEALTH_NOTIFY_ENABLED: "false",
    },
    run: async () => ({
      ok: true,
      queried: true,
      dryRun: true,
      pilotClients: 1,
      pilotIdsRejected: 0,
      findings: 1,
      opened: 1,
      updated: 0,
      resolved: 0,
      suppressedResolved: 0,
      notified: 0,
      notificationSkipped: "notify_disabled",
      failureClasses: ["uncertain_append"],
      truncated: false,
      heartbeat: "ok",
    }),
  });
  const body = (
    await dry.inject({
      method: "POST",
      url: "/delivery-health/internal/scan",
      headers: { [ADMIN_KEY_HEADER]: KEY },
    })
  ).json();
  assert.equal(body.dryRun, true);
  assert.equal(body.notified, 0);
  assert.deepEqual(body.failureClasses, ["uncertain_append"]);
  assert.equal(JSON.stringify(body).includes("lead@"), false);
  assert.equal(Object.hasOwn(body, "subjects"), false);
  await dry.close();
});
