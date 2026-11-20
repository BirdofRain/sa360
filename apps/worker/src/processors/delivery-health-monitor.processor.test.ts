import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DELIVERY_HEALTH_MONITOR_JOB } from "@sa360/shared";

import { processDeliveryHealthMonitorJob } from "./delivery-health-monitor.processor.js";

function jobFixture() {
  return { id: "delivery_health_1", name: DELIVERY_HEALTH_MONITOR_JOB, data: {} } as never;
}

test("delivery health processor does not call Google or the API while the flag is off", () => {
  const source = readFileSync(new URL("./delivery-health-monitor.processor.ts", import.meta.url), "utf8");
  const schedule = readFileSync(new URL("../lib/delivery-health-monitor-schedule.ts", import.meta.url), "utf8");
  assert.equal(source.includes("googleapis"), false);
  assert.match(source, /\/admin\/v1\/delivery-health\/internal\/scan/);
  assert.match(schedule, /attempts:\s*1/);
});

test("delivery health processor does not call the API while the flag is off", async () => {
  let calls = 0;
  const result = await processDeliveryHealthMonitorJob(jobFixture(), {
    env: {},
    postImpl: async () => {
      calls += 1;
      return { status: 200, body: "{}" };
    },
  });
  assert.equal(result.skipped, "flag_off");
  assert.equal(calls, 0);
});

test("a missing admin key fails the scan instead of reporting a healthy skip", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      processDeliveryHealthMonitorJob(jobFixture(), {
        env: { SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true" },
        postImpl: async () => {
          calls += 1;
          return { status: 200, body: "{}" };
        },
      }),
    /delivery_health_config_error:admin_key_missing/
  );
  assert.equal(calls, 0);
});

test("delivery health processor posts one scan", async () => {
  let calls = 0;
  const result = await processDeliveryHealthMonitorJob(jobFixture(), {
    env: {
      SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
      ADMIN_API_KEY: "worker-admin-key",
      SA360_API_INTERNAL_URL: "http://delivery-health.test",
    },
    postImpl: async (input) => {
      calls += 1;
      assert.equal(input.headers["x-sa360-admin-key"], "worker-admin-key");
      assert.equal(input.url, "http://delivery-health.test/admin/v1/delivery-health/internal/scan");
      assert.equal(input.body, "{}");
      assert.equal(input.timeoutMs, 60_000);
      return { status: 200, body: JSON.stringify({ ok: true, dryRun: true, queried: true, pilotClients: 1, heartbeat: "ok" }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("a non-success scan response fails the job without a second POST", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      processDeliveryHealthMonitorJob(jobFixture(), {
        env: {
          SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
          ADMIN_API_KEY: "worker-admin-key",
        },
        postImpl: async () => {
          calls += 1;
          return { status: 500, body: "{\"ok\":false}" };
        },
      }),
    /delivery_health_http_error/
  );
  assert.equal(calls, 1);
});

test("an API flag_off body or an empty pilot fails the enabled worker", async () => {
  const enabled = {
    SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
    ADMIN_API_KEY: "worker-admin-key",
  };
  await assert.rejects(
    () =>
      processDeliveryHealthMonitorJob(jobFixture(), {
        env: enabled,
        postImpl: async () => ({
          status: 200,
          body: JSON.stringify({ ok: true, skipped: "flag_off", queried: false, heartbeat: "skipped" }),
        }),
      }),
    /delivery_health_config_error:api_flag_off/
  );
  await assert.rejects(
    () =>
      processDeliveryHealthMonitorJob(jobFixture(), {
        env: enabled,
        postImpl: async () => ({
          status: 200,
          body: JSON.stringify({ ok: true, queried: false, pilotClients: 0, heartbeat: "ok" }),
        }),
      }),
    /delivery_health_config_error:pilot_unconfigured/
  );
  await assert.rejects(
    () =>
      processDeliveryHealthMonitorJob(jobFixture(), {
        env: enabled,
        postImpl: async () => ({ status: 500, body: JSON.stringify({ ok: false, error: "pilot_unconfigured" }) }),
      }),
    /delivery_health_config_error:pilot_unconfigured/
  );
});
