import assert from "node:assert/strict";
import test from "node:test";
import { Redis } from "ioredis";

import { STAFF_GOOGLE_STATE_REPLAY_PREFIX, staffGoogleStateReplayId } from "@sa360/shared/staff-google-state";

import { claimStaffGoogleStateReplay, type StaffGoogleReplayRedis } from "./staff-google-state-replay.js";

function sharedRedis(): StaffGoogleReplayRedis & { calls: number; keys: Map<string, string> } {
  const keys = new Map<string, string>();
  let calls = 0;
  let chain = Promise.resolve();
  return {
    keys,
    get calls() {
      return calls;
    },
    set(key: string, value: string, expiryMode: "EX", ttlSeconds: number, condition: "NX") {
      calls += 1;
      assert.equal(expiryMode, "EX");
      assert.equal(condition, "NX");
      assert.equal(ttlSeconds, 600);
      assert.equal(value, "1");
      const run = chain.then(() => {
        if (keys.has(key)) return null;
        keys.set(key, value);
        return "OK" as const;
      });
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
}

test("one shared replay store lets exactly one of two instances claim a state", async () => {
  const redis = sharedRedis();
  const replayId = "a".repeat(64);
  const first = claimStaffGoogleStateReplay(replayId, redis);
  const second = claimStaffGoogleStateReplay(replayId, redis);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.sort(), ["claimed", "reused"]);
  assert.equal(redis.keys.get(`${STAFF_GOOGLE_STATE_REPLAY_PREFIX}${replayId}`), "1");

  const other = await claimStaffGoogleStateReplay("b".repeat(64), redis);
  assert.equal(other, "claimed");
  const repeated = await claimStaffGoogleStateReplay(replayId, redis);
  assert.equal(repeated, "reused");
});

test("a redis failure or timeout is consumed once and fails closed", async () => {
  let calls = 0;
  const broken: StaffGoogleReplayRedis = {
    async set() {
      calls += 1;
      throw new Error("connection reset");
    },
  };
  assert.equal(await claimStaffGoogleStateReplay("c".repeat(64), broken), "unavailable");
  assert.equal(calls, 1);

  let hung = 0;
  const slow: StaffGoogleReplayRedis = {
    set() {
      hung += 1;
      return new Promise(() => undefined);
    },
  };
  assert.equal(await claimStaffGoogleStateReplay("d".repeat(64), slow, 20), "unavailable");
  assert.equal(hung, 1);
  assert.equal(await claimStaffGoogleStateReplay("not-a-replay-id", broken), "unavailable");
  assert.equal(calls, 1);
});

const LOCAL_REDIS_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_REDIS_FALLBACK_URL = "redis://127.0.0.1:6379/15";

function readSafeTestRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.SA360_TEST_REDIS_URL?.trim();
  const candidate = configured || TEST_REDIS_FALLBACK_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "redis:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_REDIS_HOSTS.has(host)) return null;
  return candidate;
}

test("the real redis integration accepts only a local test redis url", () => {
  const remote = readSafeTestRedisUrl({
    SA360_TEST_REDIS_URL: "rediss://private-db.example.com:25061",
    REDIS_URL: "redis://127.0.0.1:6379/15",
  });
  assert.equal(remote, null);
  const fallback = readSafeTestRedisUrl({ REDIS_URL: "redis://staging.example:6379" });
  assert.equal(fallback, TEST_REDIS_FALLBACK_URL);
  const selected = readSafeTestRedisUrl({ SA360_TEST_REDIS_URL: "redis://localhost:6379/2" });
  assert.equal(selected, "redis://localhost:6379/2");
});

test("two real redis clients share one atomic state claim", async (t) => {
  const redisUrl = readSafeTestRedisUrl();
  if (!redisUrl) {
    t.skip("SA360_TEST_REDIS_URL is not a local test Redis; the real Redis integration did not run");
    return;
  }
  const state = "browser-state-value-that-must-not-appear-in-redis";
  const replayId = staffGoogleStateReplayId(state);
  const key = `${STAFF_GOOGLE_STATE_REPLAY_PREFIX}${replayId}`;
  const options = {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };
  const probe = new Redis(redisUrl, options);
  probe.on("error", () => undefined);
  try {
    await probe.connect();
    await probe.ping();
  } catch {
    t.skip("safe local test Redis unavailable; the real Redis integration did not run");
    return;
  } finally {
    probe.disconnect();
  }

  const first = new Redis(redisUrl, options);
  const second = new Redis(redisUrl, options);
  first.on("error", () => undefined);
  second.on("error", () => undefined);
  try {
    await first.connect();
    await second.connect();
    await first.del(key);
    const results = await Promise.all([
      claimStaffGoogleStateReplay(replayId, {
        set: (redisKey, value, expiryMode, ttlSeconds, condition) => first.set(redisKey, value, expiryMode, ttlSeconds, condition),
      }),
      claimStaffGoogleStateReplay(replayId, {
        set: (redisKey, value, expiryMode, ttlSeconds, condition) => second.set(redisKey, value, expiryMode, ttlSeconds, condition),
      }),
    ]);
    assert.deepEqual(results.slice().sort(), ["claimed", "reused"]);
    assert.equal(await first.get(key), "1");
    const ttl = await first.ttl(key);
    assert.equal(ttl > 0 && ttl <= 600, true);
    assert.equal(key.includes(state), false);
    const stored = await first.get(key);
    assert.equal(stored?.includes("verifier"), false);
  } finally {
    try {
      if (first.status === "ready") await first.del(key);
    } finally {
      first.disconnect();
      second.disconnect();
    }
  }
});
