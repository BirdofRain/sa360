import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import Fastify from "fastify";

import { getAdminApiKey } from "../lib/admin-auth.js";
import { resetBuyerInventoryAvailabilityJobsForTests } from "../services/ppl-fulfillment/buyer-inventory-availability-jobs.js";
import type { BuyerInventoryAvailabilityResult } from "../services/ppl-fulfillment/buyer-inventory-availability.service.js";
import { adminFulfillmentOpsRoutes } from "./admin-fulfillment-ops.js";

afterEach(() => {
  resetBuyerInventoryAvailabilityJobsForTests();
});

function withAdminEnv(flag: string | undefined, run: () => Promise<void>) {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevFlag = process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
  process.env.ADMIN_API_KEY = "test-admin-key";
  if (flag === undefined) delete process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
  else process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = flag;
  return run().finally(() => {
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
    else process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = prevFlag;
  });
}

test("admin availability jobs stay gated and do not publish an interrupted total", async () => {
  await withAdminEnv("true", async () => {
    let release: (result: BuyerInventoryAvailabilityResult) => void = () => undefined;
    let calls = 0;
    const app = Fastify({ logger: false });
    await app.register(adminFulfillmentOpsRoutes, {
      prefix: "/admin/v1",
      lookupBuyerInventoryAvailabilityImpl: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const headers = { "x-sa360-admin-key": getAdminApiKey()! };
    try {
      const anonymous = await app.inject({
        method: "POST",
        url: "/admin/v1/fulfillment-ops/buyer-availability/jobs",
        payload: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
      });
      assert.equal(anonymous.statusCode, 401);
      assert.equal(calls, 0);

      const invalid = await app.inject({
        method: "POST",
        url: "/admin/v1/fulfillment-ops/buyer-availability/jobs",
        headers,
        payload: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["Georgia"] },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.json().code, "invalid_states");
      assert.equal(calls, 0);

      const started = await app.inject({
        method: "POST",
        url: "/admin/v1/fulfillment-ops/buyer-availability/jobs",
        headers,
        payload: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
      });
      assert.equal(started.statusCode, 202);
      const jobId = started.json().jobId as string;
      assert.equal(started.json().status, "running");
      assert.equal(calls, 1);

      const running = await app.inject({
        method: "GET",
        url: `/admin/v1/fulfillment-ops/buyer-availability/jobs/${jobId}`,
        headers,
      });
      assert.equal(running.statusCode, 200);
      assert.equal(running.json().status, "running");
      assert.equal(running.json().result, undefined);

      const busy = await app.inject({
        method: "POST",
        url: "/admin/v1/fulfillment-ops/buyer-availability/jobs",
        headers,
        payload: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["TX"] },
      });
      assert.equal(busy.statusCode, 503);
      assert.equal(busy.json().code, "availability_job_busy");

      release({
        ok: true,
        eligibleTotal: 12,
        eligibleCountSemantics: "exact",
        queryCompleteness: "complete",
      } as BuyerInventoryAvailabilityResult);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const done = await app.inject({
        method: "GET",
        url: `/admin/v1/fulfillment-ops/buyer-availability/jobs/${jobId}`,
        headers,
      });
      assert.equal(done.statusCode, 200);
      assert.equal(done.json().status, "complete");
      assert.equal(done.json().result.eligibleTotal, 12);
      assert.equal(done.json().result.eligibleCountSemantics, "exact");
      assert.equal(done.json().effects.orderCreated, false);
    } finally {
      await app.close();
    }
  });
});

test("admin availability jobs stay disabled with the lookup flag", async () => {
  await withAdminEnv(undefined, async () => {
    const app = Fastify({ logger: false });
    await app.register(adminFulfillmentOpsRoutes, { prefix: "/admin/v1" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/v1/fulfillment-ops/buyer-availability/jobs",
        headers: { "x-sa360-admin-key": getAdminApiKey()! },
        payload: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error, "buyer_inventory_availability_disabled");
    } finally {
      await app.close();
    }
  });
});
