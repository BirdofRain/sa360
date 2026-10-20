import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { portalBuyerAvailabilityRoutes } from "./portal-buyer-availability.js";

test("portal buyer availability is hidden when the flag is off", async () => {
  const app = Fastify();
  await app.register(portalBuyerAvailabilityRoutes, {
    prefix: "/client/v1",
    enabled: () => false,
    requirePortalTenant: async () => {
      throw new Error("tenant should not be resolved");
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/client/v1/inventory/buyer-availability",
    payload: { nicheKey: "vet", states: ["TX"], commerceAgeBucketKeys: ["COMMERCE_1_3_MO"] },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "portal_live_inventory_disabled");
  await app.close();
});

test("portal buyer availability uses the session tenant and rejects a browser client id", async () => {
  const seen: string[] = [];
  const app = Fastify();
  await app.register(portalBuyerAvailabilityRoutes, {
    prefix: "/client/v1",
    enabled: () => true,
    requirePortalTenant: async () => ({ clientAccountId: "session-buyer" }),
    lookup: (async (input: { clientAccountId: string; productType?: string | null }) => {
      seen.push(input.clientAccountId);
      if (input.productType) {
        return { ok: false as const, code: "unsupported_filter", reasons: ["product_type_not_supported"] };
      }
      return {
        ok: true as const,
        reservesInventory: false as const,
        evaluatedAt: "2026-10-19T15:00:00.000Z",
        criteria: { nicheKey: "vet", states: ["TX"], commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], productType: null },
        buckets: [],
      };
    }) as never,
  });

  const override = await app.inject({
    method: "POST",
    url: "/client/v1/inventory/buyer-availability?clientAccountId=other",
    payload: {
      clientAccountId: "other",
      nicheKey: "vet",
      states: ["TX"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
    },
  });
  assert.equal(override.statusCode, 400);
  assert.equal(seen.length, 0);

  const product = await app.inject({
    method: "POST",
    url: "/client/v1/inventory/buyer-availability",
    payload: {
      nicheKey: "vet",
      states: ["TX"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      productType: "exclusive",
    },
  });
  assert.equal(product.statusCode, 400);
  assert.equal(product.json().code, "unsupported_filter");
  assert.deepEqual(seen, ["session-buyer"]);

  const ok = await app.inject({
    method: "POST",
    url: "/client/v1/inventory/buyer-availability",
    payload: { nicheKey: "vet", states: ["TX"], commerceAgeBucketKeys: ["COMMERCE_1_3_MO"] },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().reservesInventory, false);
  assert.deepEqual(seen, ["session-buyer", "session-buyer"]);
  await app.close();
});
