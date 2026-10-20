import assert from "node:assert/strict";
import test from "node:test";

import {
  claimPortalOrderIdempotency,
  type PortalOrderIdempotencyStore,
} from "./portal-order-idempotency.js";

function memoryStore(): PortalOrderIdempotencyStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async claim(key) {
      const existing = values.get(key);
      if (existing) return existing;
      values.set(key, "pending");
      return "acquired";
    },
    async complete(key, orderId) {
      values.set(key, orderId);
    },
    async release(key) {
      if (values.get(key) === "pending") values.delete(key);
    },
  };
}

test("missing idempotency key keeps the legacy create path", async () => {
  const claim = await claimPortalOrderIdempotency("buyer_a", undefined, null);
  assert.equal(claim.status, "acquired");
});

test("idempotency replays the stored order and blocks an in-progress retry", async () => {
  const store = memoryStore();
  const first = await claimPortalOrderIdempotency("buyer_a", "portal-order-12345678", store);
  assert.equal(first.status, "acquired");
  const pending = await claimPortalOrderIdempotency("buyer_a", "portal-order-12345678", store);
  assert.equal(pending.status, "in_progress");
  await store.complete("portal:lead-order:idempotency:buyer_a:portal-order-12345678", "ord_1");
  const replay = await claimPortalOrderIdempotency("buyer_a", "portal-order-12345678", store);
  assert.deepEqual(replay, { status: "replay", orderId: "ord_1" });
  const otherBuyer = await claimPortalOrderIdempotency("buyer_b", "portal-order-12345678", store);
  assert.equal(otherBuyer.status, "acquired");
});

test("a broken idempotency store does not create a second order key", async () => {
  const claim = await claimPortalOrderIdempotency("buyer_a", "portal-order-12345678", {
    async claim() {
      throw new Error("redis down");
    },
    async complete() {},
    async release() {},
  });
  assert.equal(claim.status, "unavailable");
  const invalid = await claimPortalOrderIdempotency("buyer_a", "short", memoryStore());
  assert.equal(invalid.status, "invalid");
});
