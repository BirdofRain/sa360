import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

function isNodeTestRuntime() {
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.npm_lifecycle_event === "test") return true;
  if (process.argv.some((arg) => arg === "--test" || arg.startsWith("--test-"))) return true;
  if (process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test-"))) return true;
  // tsx test workers run the file path directly without --test in argv.
  if (process.argv.some((arg) => /[/\\][^/\\]+\.test\.(t|j)s$/.test(arg))) return true;
  return false;
}

const REDIS_FALLBACK_URL = "redis://127.0.0.1:6379";
const TEST_REDIS_FALLBACK_URL = "redis://127.0.0.1:6379/15";

const shouldUseFailFastTestMode =
  (
    process.env.NODE_ENV === "test" ||
    isNodeTestRuntime() ||
    process.env.npm_lifecycle_event === "test"
  ) &&
  process.env.SA360_REDIS_TEST_FAIL_FAST !== "false";

function resolveRedisUrl(): string {
  if (shouldUseFailFastTestMode) {
    // Never use ambient REDIS_URL in tests — avoids shared staging/production Redis.
    return process.env.SA360_TEST_REDIS_URL?.trim() || TEST_REDIS_FALLBACK_URL;
  }
  return process.env.REDIS_URL?.trim() || REDIS_FALLBACK_URL;
}

const redisUrl = resolveRedisUrl();

let redisClient: Redis | null = null;

function attachTestHandlers(client: Redis) {
  client.on("error", (err) => {
    if (process.env.SA360_REDIS_TEST_VERBOSE === "true") {
      console.warn(`[redis:test] ${err.message}`);
    }
  });
  client.on("connect", () => {
    (globalThis as { __sa360RedisConnectedInTests?: boolean }).__sa360RedisConnectedInTests =
      true;
  });
}

function createRedisClient(): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: shouldUseFailFastTestMode ? 1 : null,
    lazyConnect: shouldUseFailFastTestMode,
    enableOfflineQueue: !shouldUseFailFastTestMode,
    connectTimeout: shouldUseFailFastTestMode ? 1_000 : undefined,
    retryStrategy: shouldUseFailFastTestMode ? () => null : undefined,
  });
  if (shouldUseFailFastTestMode) {
    attachTestHandlers(client);
  }
  return client;
}

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

export const redis: Redis = shouldUseFailFastTestMode
  ? (new Proxy({} as Redis, {
      get(_target, prop, receiver) {
        const client = getRedisClient();
        const value = Reflect.get(client, prop, receiver);
        return typeof value === "function" ? value.bind(client) : value;
      },
    }) as Redis)
  : createRedisClient();

export function wasRedisConnectedInTests(): boolean {
  return Boolean(
    (globalThis as { __sa360RedisConnectedInTests?: boolean }).__sa360RedisConnectedInTests
  );
}

export function wasRedisClientInitialized(): boolean {
  return redisClient !== null;
}

/** Bounded, test-only Redis shutdown. No-op when the client was never initialized. */
export async function disconnectRedisForTests(timeoutMs = 2_000): Promise<void> {
  if (!redisClient) {
    return;
  }

  const client = redisClient;
  if (client.status === "end" || client.status === "close") {
    redisClient = null;
    return;
  }

  if (!wasRedisConnectedInTests()) {
    client.disconnect(true);
    redisClient = null;
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      const done = () => {
        client.removeListener("end", done);
        client.removeListener("error", onError);
        resolve();
      };
      const onError = () => {
        client.removeListener("end", done);
        client.removeListener("error", onError);
        resolve();
      };
      client.once("end", done);
      client.once("error", onError);
      client.disconnect(false);
    }),
    new Promise<void>((_, reject) => {
      setTimeout(
        () => reject(new Error(`redis disconnect timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    }),
  ])
    .catch((err) => {
      client.disconnect(true);
      throw err;
    })
    .finally(() => {
      redisClient = null;
    });
}
