import assert from "node:assert/strict";
import test from "node:test";
import { Redis } from "ioredis";

import { signStaffSession, staffSessionRegistryKey } from "@sa360/shared/staff-google-session";

import {
  activeValue,
  createMemoryStaffSessionRegistry,
  createRedisStaffSessionRegistry,
  revokedValue,
  type StaffSessionRegistry,
} from "./staff-session-registry.js";

const SECRET = "staff-session-secret-at-least-32-characters";
const PRINCIPAL = "c123456789012345678901234";
const SUB = "102938475610293847561";
const NOW = 1_800_000_000;
const LOCAL_REDIS_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_REDIS_FALLBACK_URL = "redis://127.0.0.1:6379/15";

function session(sessionId: string, nowSec = NOW) {
  return signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: SUB,
    nowSec,
    sessionId,
    secret: SECRET,
  }).claims;
}

async function expectRevokedAfterRace(registry: StaffSessionRegistry, claims = session("session-id-race-0123456789")) {
  const results = await Promise.all([registry.register(claims, NOW), registry.revoke(claims, NOW)]);
  assert.equal(results.includes("unavailable"), false);
  assert.equal(await registry.read(claims, NOW), "revoked");
  assert.equal(await registry.register(claims, NOW), "rejected");
}

test("a registered session is readable once and a revoked id cannot return", async () => {
  const registry = createMemoryStaffSessionRegistry();
  const claims = session("session-id-0123456789abcd");
  assert.equal(await registry.read(claims, NOW), "missing");
  assert.equal(await registry.register(claims, NOW), "registered");
  assert.equal(await registry.register(claims, NOW), "rejected");
  assert.equal(await registry.read(claims, NOW), "active");
  assert.equal(activeValue(claims).includes(claims.jti), false);
  assert.equal(activeValue(claims).includes(SECRET), false);
  assert.equal(staffSessionRegistryKey(claims.jti).includes(claims.jti), false);

  const other = createMemoryStaffSessionRegistry();
  assert.equal(await other.read(claims, NOW), "missing");
  assert.equal(await registry.revoke(claims, NOW), "revoked");
  assert.equal(await registry.revoke(claims, NOW), "revoked");
  assert.equal(await registry.read(claims, NOW), "revoked");
  assert.equal(await registry.register(claims, NOW), "rejected");
  assert.equal(revokedValue(claims).startsWith("v1|revoked|"), true);
});

test("register and revoke leave a revoked record across shared callers", async () => {
  const registry = createMemoryStaffSessionRegistry();
  const first = registry;
  const second = registry;
  const claims = session("session-id-shared-012345678");
  assert.equal(await first.register(claims, NOW), "registered");
  assert.equal(await second.read(claims, NOW), "active");
  assert.equal(await second.revoke(claims, NOW), "revoked");
  assert.equal(await first.read(claims, NOW), "revoked");
  await expectRevokedAfterRace(registry, session("session-id-memory-race-0123"));
});

test("an expired registry record and a redis failure deny access", async () => {
  const registry = createMemoryStaffSessionRegistry();
  const claims = session("session-id-expiry-012345678");
  assert.equal(await registry.register(claims, claims.exp), "unavailable");
  const live = session("session-id-live-0123456789ab");
  assert.equal(await registry.register(live, NOW), "registered");
  assert.equal(await registry.read(live, live.exp), "missing");

  let calls = 0;
  const broken = createRedisStaffSessionRegistry({
    async eval() {
      calls += 1;
      throw new Error("connection reset");
    },
    async get() {
      calls += 1;
      throw new Error("connection reset");
    },
  });
  assert.equal(await broken.register(live, NOW), "unavailable");
  assert.equal(await broken.read(live, NOW), "unavailable");
  assert.equal(await broken.revoke(live, NOW), "unavailable");
  assert.equal(calls, 3);

  const slow = createRedisStaffSessionRegistry(
    {
      eval() {
        return new Promise(() => undefined);
      },
      get() {
        return new Promise(() => undefined);
      },
    },
    20
  );
  assert.equal(await slow.read(live, NOW), "unavailable");
});

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

test("two real redis clients share staff session registration and revocation", async (t) => {
  const redisUrl = readSafeTestRedisUrl();
  if (!redisUrl) {
    t.skip("SA360_TEST_REDIS_URL is not a local test Redis; the real Redis integration did not run");
    return;
  }
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

  const claims = session(`session-id-redis-${Date.now().toString(36)}`);
  const raced = session(`session-id-redis-race-${Date.now().toString(36)}`);
  const key = staffSessionRegistryKey(claims.jti);
  const raceKey = staffSessionRegistryKey(raced.jti);
  const firstClient = new Redis(redisUrl, options);
  const secondClient = new Redis(redisUrl, options);
  firstClient.on("error", () => undefined);
  secondClient.on("error", () => undefined);
  const first = createRedisStaffSessionRegistry(firstClient);
  const second = createRedisStaffSessionRegistry(secondClient);
  try {
    await firstClient.connect();
    await secondClient.connect();
    await firstClient.del(key, raceKey);
    assert.equal(await first.register(claims, NOW), "registered");
    assert.equal(await second.read(claims, NOW), "active");
    const stored = await firstClient.get(key);
    assert.equal(stored, activeValue(claims));
    assert.equal(stored?.includes(claims.jti), false);
    assert.equal(stored?.includes(SECRET), false);
    const ttl = await firstClient.ttl(key);
    assert.equal(ttl > 0 && ttl <= 8 * 60 * 60, true);
    assert.equal(await second.revoke(claims, NOW), "revoked");
    assert.equal(await first.read(claims, NOW), "revoked");
    assert.equal(await first.register(claims, NOW), "rejected");
    assert.equal(await second.revoke(claims, NOW), "revoked");
    const results = await Promise.all([first.register(raced, NOW), second.revoke(raced, NOW)]);
    assert.equal(results.includes("unavailable"), false);
    assert.equal(await first.read(raced, NOW), "revoked");
  } finally {
    try {
      if (firstClient.status === "ready") await firstClient.del(key, raceKey);
    } finally {
      firstClient.disconnect();
      secondClient.disconnect();
    }
  }
});
