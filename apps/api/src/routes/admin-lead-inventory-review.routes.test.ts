import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { adminLeadInventoryRoutes } from "./admin-lead-inventory.js";

async function withAdminApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevFlag = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.ADMIN_API_KEY = "inventory-review-test-key";
  delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  const app = Fastify({ logger: false });
  await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
  try {
    await run(app);
  } finally {
    await app.close();
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prevFlag;
  }
}

test("review summary requires admin auth", async () => {
  await withAdminApp(async (app) => {
    const unauthorized = await app.inject({
      method: "GET",
      url: "/admin/v1/lead-inventory/review/summary",
    });
    assert.equal(unauthorized.statusCode, 401);
  });
});

test("review action preview requires admin auth", async () => {
  await withAdminApp(async (app) => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/admin/v1/lead-inventory/review/actions/preview",
      payload: {
        requestId: "req-review-1",
        actionType: "make_available",
        itemIds: ["item_1"],
      },
    });
    assert.equal(unauthorized.statusCode, 401);
  });
});

test("review action commit fails closed when feature disabled", async () => {
  await withAdminApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/lead-inventory/review/actions/commit",
      headers: { "x-sa360-admin-key": "inventory-review-test-key" },
      payload: {
        requestId: "req-review-2",
        actionType: "make_available",
        itemIds: ["item_1"],
        selectionFingerprint: "a".repeat(64),
        confirmationPhrase: "MAKE REVIEWED INVENTORY AVAILABLE",
        reasonCode: "review_passed",
      },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.code, "review_activation_disabled");
  });
});

test("review action commit rejects wrong confirmation phrase", async () => {
  const prevKey = process.env.ADMIN_API_KEY;
  const prevFlag = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.ADMIN_API_KEY = "inventory-review-test-key";
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "true";
  const app = Fastify({ logger: false });
  await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/lead-inventory/review/actions/commit",
      headers: { "x-sa360-admin-key": "inventory-review-test-key" },
      payload: {
        requestId: "req-review-3",
        actionType: "make_available",
        itemIds: ["item_1"],
        selectionFingerprint: "a".repeat(64),
        confirmationPhrase: "WRONG PHRASE",
        reasonCode: "review_passed",
      },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "invalid_confirmation");
  } finally {
    await app.close();
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prevFlag;
  }
});

test("review items query rejects oversized limit", async () => {
  await withAdminApp(async (app) => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/lead-inventory/review/items?limit=500",
      headers: { "x-sa360-admin-key": "inventory-review-test-key" },
    });
    assert.equal(res.statusCode, 400);
  });
});
