import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

function isNodeTestRuntime() {
  return process.argv.some((arg) => arg === "--test" || arg.startsWith("--test-"));
}

const REDIS_FALLBACK_URL = "redis://127.0.0.1:6379";
const redisUrl = process.env.REDIS_URL?.trim() || REDIS_FALLBACK_URL;
const shouldUseFailFastTestMode =
  (
    process.env.NODE_ENV === "test" ||
    isNodeTestRuntime() ||
    process.env.npm_lifecycle_event === "test"
  ) &&
  process.env.SA360_REDIS_TEST_FAIL_FAST !== "false";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: shouldUseFailFastTestMode ? 1 : null,
  lazyConnect: shouldUseFailFastTestMode,
  enableOfflineQueue: !shouldUseFailFastTestMode,
  connectTimeout: shouldUseFailFastTestMode ? 1_000 : undefined,
  retryStrategy: shouldUseFailFastTestMode ? () => null : undefined,
});