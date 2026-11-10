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

test("two local redis clients share one atomic state claim", async () => {
  const state = "browser-state-value-that-must-not-appear-in-redis";
  const replayId = staffGoogleStateReplayId(state);
  const key = `${STAFF_GOOGLE_STATE_REPLAY_PREFIX}${replayId}`;
  const options = { maxRetriesPerRequest: 1, connectTimeout: 1_000, lazyConnect: true };
  const first = new Redis("redis://127.0.0.1:6379/15", options);
  const second = new Redis("redis://127.0.0.1:6379/15", options);
  try {
    await first.connect();
    await second.connect();
    await first.del(key);
    const results = await Promise.all([
      claimStaffGoogleStateReplay(replayId, {
        set: (key, value, expiryMode, ttlSeconds, condition) => first.set(key, value, expiryMode, ttlSeconds, condition),
      }),
      claimStaffGoogleStateReplay(replayId, {
        set: (key, value, expiryMode, ttlSeconds, condition) => second.set(key, value, expiryMode, ttlSeconds, condition),
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
    await first.del(key);
    first.disconnect();
    second.disconnect();
  }
});
