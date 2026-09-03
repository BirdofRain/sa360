import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeRedisRateLimit,
  hashRateLimitValue,
  portalPasswordResetRateLimitBucket,
} from "./redis-rate-limit.js";

test("portal password reset rate-limit buckets hash the identifier and omit the raw value", () => {
  const email = "customer@example.com";
  const bucket = portalPasswordResetRateLimitBucket("email", email);
  assert.equal(bucket.includes(email), false);
  assert.equal(bucket.startsWith("portal-pw-reset:email:"), true);
  assert.equal(bucket, `portal-pw-reset:email:${hashRateLimitValue(email)}`);
  assert.notEqual(
    portalPasswordResetRateLimitBucket("email", email),
    portalPasswordResetRateLimitBucket("ip", "203.0.113.9")
  );
});

test("consumeRedisRateLimit allows up to the limit then denies", async () => {
  const store = new Map<string, number>();
  const fake = {
    incr: async (key: string) => {
      const n = (store.get(key) ?? 0) + 1;
      store.set(key, n);
      return n;
    },
    pexpire: async () => 1,
    pttl: async () => 60_000,
  };
  const first = await consumeRedisRateLimit("test-bucket", 2, 60_000, fake as never);
  const second = await consumeRedisRateLimit("test-bucket", 2, 60_000, fake as never);
  const third = await consumeRedisRateLimit("test-bucket", 2, 60_000, fake as never);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal([...store.keys()][0]?.includes("sa360:rl:"), true);
});
