import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFulfillmentOutboxIdempotencyKey,
  buildShadowAllocationIdempotencyKey,
} from "./fulfillment-keys.js";

test("outbox and allocation idempotency keys are stable per source lead", () => {
  const outboxA = buildFulfillmentOutboxIdempotencyKey("evt_123");
  const outboxB = buildFulfillmentOutboxIdempotencyKey("evt_123");
  const allocationA = buildShadowAllocationIdempotencyKey("evt_123");
  const allocationB = buildShadowAllocationIdempotencyKey("evt_123");
  assert.equal(outboxA, outboxB);
  assert.equal(allocationA, allocationB);
  assert.notEqual(outboxA, allocationA);
});
