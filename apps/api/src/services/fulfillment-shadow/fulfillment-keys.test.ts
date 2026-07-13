import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFulfillmentOutboxIdempotencyKey,
  buildFulfillmentShadowQueueJobId,
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

test("database outbox idempotency keys may contain colons and stay separate from queue job IDs", () => {
  const outboxIdempotencyKey = buildFulfillmentOutboxIdempotencyKey("evt_123");
  const queueJobId = buildFulfillmentShadowQueueJobId("outbox_123");

  assert.match(outboxIdempotencyKey, /:/);
  assert.doesNotMatch(queueJobId, /:/);
  assert.notEqual(outboxIdempotencyKey, queueJobId);
});

test("queue job ID is deterministic for the same outbox ID", () => {
  const first = buildFulfillmentShadowQueueJobId("cmrjcuc2506m2k40tiqnnu1xp");
  const second = buildFulfillmentShadowQueueJobId("cmrjcuc2506m2k40tiqnnu1xp");
  assert.equal(first, second);
  assert.equal(first, "fulfillment-shadow-cmrjcuc2506m2k40tiqnnu1xp");
});

test("queue job ID differs for different outbox IDs", () => {
  const first = buildFulfillmentShadowQueueJobId("outbox_a");
  const second = buildFulfillmentShadowQueueJobId("outbox_b");
  assert.notEqual(first, second);
});

test("queue job ID trims leading and trailing whitespace", () => {
  assert.equal(
    buildFulfillmentShadowQueueJobId("  outbox_123  "),
    buildFulfillmentShadowQueueJobId("outbox_123")
  );
});

test("queue job ID rejects empty or whitespace-only outbox IDs", () => {
  assert.throws(() => buildFulfillmentShadowQueueJobId(""), /outbox_id_required/);
  assert.throws(() => buildFulfillmentShadowQueueJobId("   "), /outbox_id_required/);
});
