import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

import { redis as defaultRedis } from "./redis.js";

export type RateLimitConsumeResult = { allowed: boolean };

export type RateLimitConsume = (
  bucket: string,
  limit: number,
  windowMs: number
) => Promise<RateLimitConsumeResult>;

const KEY_PREFIX = "sa360:rl:";

function rateLimitKey(bucket: string): string {
  return `${KEY_PREFIX}${bucket}`;
}

/**
 * Fixed-window Redis limiter (INCR + PEXPIRE).
 * `bucket` should already be a non-secret identifier (hash PII first).
 */
export async function consumeRedisRateLimit(
  bucket: string,
  limit: number,
  windowMs: number,
  client: Redis = defaultRedis
): Promise<RateLimitConsumeResult> {
  const key = rateLimitKey(bucket);
  const n = await client.incr(key);
  if (n === 1) {
    await client.pexpire(key, windowMs);
  } else {
    const ttl = await client.pttl(key);
    if (ttl < 0) {
      await client.pexpire(key, windowMs);
    }
  }
  return { allowed: n <= limit };
}

export function hashRateLimitValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function portalPasswordResetRateLimitBucket(
  kind: "email" | "ip",
  value: string
): string {
  return `portal-pw-reset:${kind}:${hashRateLimitValue(value)}`;
}

export const defaultRedisRateLimitConsume: RateLimitConsume = (bucket, limit, windowMs) =>
  consumeRedisRateLimit(bucket, limit, windowMs);
